"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OUTLINER_CLIPBOARD_MIME, useOutlineStore } from "@/lib/store/useOutlineStore";
import {
  buildPlainTextOutline,
  buildTree,
  getSiblings,
  isSelfOrDescendant,
  midpointPosition,
} from "@/lib/utils/tree";
import { OutlineNode } from "./OutlineNode";
import { DndContext, type DragOverState } from "./DndContext";

/**
 * OSクリップボードへ書き込む(Ctrl+Cでの複数ノードコピー、他アプリへの貼り付け・
 * 実際のCtrl+Vでの階層保持貼り付け用)。旧来のdocument.execCommand("copy")による
 * ダミー要素選択トリックは、document自体がフォーカスされていない状況や、
 * ブラウザによる制限強化で確実に動くとは言えなくなっているため、非同期Clipboard API
 * (navigator.clipboard.write / writeText)を使う。カスタムMIMEタイプ付きの書き込みに
 * 失敗した場合はプレーンテキストのみへ、それも失敗した場合は静かに諦める。
 */
async function writeToOsClipboard(plainText: string, treePayload: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          [OUTLINER_CLIPBOARD_MIME]: new Blob([treePayload], { type: OUTLINER_CLIPBOARD_MIME }),
        }),
      ]);
      return;
    }
  } catch {
    // カスタムMIME付きの書き込みが拒否される環境向けに、プレーンテキストのみで再試行する
  }
  try {
    await navigator.clipboard.writeText?.(plainText);
  } catch {
    // OSクリップボードへの書き込みが一切できない環境。アプリ内貼り付けには影響しない
  }
}

/**
 * アウトライン本体。ツリー構築、ポインターベースのドラッグ&ドロップ(並べ替え・
 * スマート構造化ブロックへの出し入れ)、マウスドラッグによる複数行の範囲選択、
 * Undo/Redoのグローバルショートカットを担当する。
 * ドラッグ検出は要素デリゲーション(elementFromPoint)方式で、
 * マウス/タッチ双方をPointer Eventsだけでカバーする。
 */
export function Outliner() {
  const nodes = useOutlineStore((s) => s.nodes);
  const loading = useOutlineStore((s) => s.loading);
  const moveNodeTo = useOutlineStore((s) => s.moveNodeTo);
  const moveNodesTo = useOutlineStore((s) => s.moveNodesTo);
  const selectedNodeIds = useOutlineStore((s) => s.selectedNodeIds);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const selectRangeNodes = useOutlineStore((s) => s.selectRangeNodes);
  const deleteNodesBulk = useOutlineStore((s) => s.deleteNodesBulk);
  const indentNodes = useOutlineStore((s) => s.indentNodes);
  const outdentNodes = useOutlineStore((s) => s.outdentNodes);
  const buildClipboardPayload = useOutlineStore((s) => s.buildClipboardPayload);
  const pasteClipboardPayload = useOutlineStore((s) => s.pasteClipboardPayload);

  const containerRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildTree(Object.values(nodes)), [nodes]);

  // メモ全体を選択している間(Notion風の2段階Ctrl+A、またはマウスドラッグでの範囲選択)は、
  // コピーをブラウザ標準のテキスト選択ではなく、階層をインデントで表したプレーンテキストとして書き出す。
  // 加えて、アプリ内貼り付け専用のカスタムMIME(OUTLINER_CLIPBOARD_MIME)にツリー構造(親子関係)を
  // JSONで書き込んでおくことで、他アプリへは読みやすいプレーンテキストとして、
  // このアプリ内へは階層を保ったまま貼り付けられる
  const handleCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (selectedNodeIds.length === 0) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", buildPlainTextOutline(tree));
      e.clipboardData.setData(OUTLINER_CLIPBOARD_MIME, buildClipboardPayload(selectedNodeIds));
    },
    [selectedNodeIds, tree, buildClipboardPayload]
  );

  // カット: コピーと同じ内容をクリップボードへ書き込んでから、選択ノードを一括削除する
  const handleCut = useCallback(
    (e: React.ClipboardEvent) => {
      if (selectedNodeIds.length === 0) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", buildPlainTextOutline(tree));
      e.clipboardData.setData(OUTLINER_CLIPBOARD_MIME, buildClipboardPayload(selectedNodeIds));
      deleteNodesBulk(selectedNodeIds);
    },
    [selectedNodeIds, tree, buildClipboardPayload, deleteNodesBulk]
  );

  // アプリ内貼り付け: カスタムMIMEが載っていれば、通常のペースト処理(1行のプレーンテキスト
  // 展開)より先に(capture段階で)横取りして、ツリー構造を保ったまま現在のノードの直後へ挿入する。
  // e.clipboardDataという「実際のOSクリップボードの中身」だけを見る(古いコピー内容を
  // 誤って貼り付けてしまわないよう、アプリ内部の記憶には一切頼らない)。
  const handlePasteCapture = useCallback(
    (e: React.ClipboardEvent) => {
      const payload = e.clipboardData?.getData(OUTLINER_CLIPBOARD_MIME);
      if (!payload || !activeNodeId) return;
      const ok = pasteClipboardPayload(payload, activeNodeId);
      if (ok) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [activeNodeId, pasteClipboardPayload]
  );

  // 複数選択中のCtrl/Cmd+C・Xから呼ばれる。ノード単位の複数選択はネイティブのテキスト
  // 選択を伴わないことが多く、そのままではブラウザのcopy/cutイベント自体が発火しない
  // ことがあるため、ここで検知してOSクリップボードへ直接書き込む(専用のボタンUIは持たず、
  // キーボード操作だけで完結する)。
  const handleCopyShortcut = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    void writeToOsClipboard(buildPlainTextOutline(tree), buildClipboardPayload(selectedNodeIds));
  }, [selectedNodeIds, tree, buildClipboardPayload]);

  const handleCutShortcut = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    void writeToOsClipboard(buildPlainTextOutline(tree), buildClipboardPayload(selectedNodeIds));
    deleteNodesBulk(selectedNodeIds);
  }, [selectedNodeIds, tree, buildClipboardPayload, deleteNodesBulk]);

  // ------------------------------------------------------------
  // 行の並べ替え・スマート構造化ブロックへの出し入れ(ポインターイベント)
  // ------------------------------------------------------------
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOverState | null>(null);

  useEffect(() => {
    if (dragging) {
      document.body.classList.add("select-none", "cursor-grabbing");
    } else {
      document.body.classList.remove("select-none", "cursor-grabbing");
    }
    return () => document.body.classList.remove("select-none", "cursor-grabbing");
  }, [dragging]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest("[data-node-id]") as HTMLElement | null;
      if (!row) {
        setDragOver((prev) => (prev ? null : prev));
        return;
      }
      const overId = row.getAttribute("data-node-id")!;
      const allNodes = Object.values(useOutlineStore.getState().nodes);
      const draggingSet =
        selectedNodeIds.includes(dragging) && selectedNodeIds.length > 1
          ? selectedNodeIds
          : [dragging];
      if (draggingSet.includes(overId) || draggingSet.some((id) => isSelfOrDescendant(allNodes, id, overId))) {
        setDragOver((prev) => (prev ? null : prev));
        return;
      }
      const rect = row.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      // 上下25%は兄弟としての前後挿入、中央50%は「その行の子として入れ込む」ゾーンにする
      // (スマート構造化ブロックへドラッグで直接入れ込めるようにするため)
      const position: "before" | "after" | "into" =
        ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "into";
      setDragOver((prev) =>
        prev && prev.overId === overId && prev.position === position && prev.draggingId === dragging
          ? prev
          : { draggingId: dragging, overId, position }
      );
    },
    [dragging, selectedNodeIds]
  );

  const handlePointerUp = useCallback(() => {
    if (dragging && dragOver) {
      const allNodes = Object.values(useOutlineStore.getState().nodes);
      const target = allNodes.find((n) => n.id === dragOver.overId);
      const isBulk = selectedNodeIds.includes(dragging) && selectedNodeIds.length > 1;
      const movingSet = isBulk ? selectedNodeIds : [dragging];
      if (target) {
        if (dragOver.position === "into") {
          const children = getSiblings(allNodes, target.id).filter((s) => !movingSet.includes(s.id));
          const lastChildPos = children[children.length - 1]?.position;
          if (isBulk) {
            moveNodesTo(movingSet, target.id, lastChildPos, undefined);
          } else {
            moveNodeTo(dragging, target.id, midpointPosition(lastChildPos, undefined));
          }
        } else {
          const siblings = getSiblings(allNodes, target.parentId).filter((s) => !movingSet.includes(s.id));
          const idx = siblings.findIndex((s) => s.id === target.id);
          const prevPos = dragOver.position === "before" ? siblings[idx - 1]?.position : target.position;
          const nextPos = dragOver.position === "before" ? target.position : siblings[idx + 1]?.position;
          if (isBulk) {
            moveNodesTo(movingSet, target.parentId, prevPos, nextPos);
          } else {
            moveNodeTo(dragging, target.parentId, midpointPosition(prevPos, nextPos));
          }
        }
      }
    }
    setDragging(null);
    setDragOver(null);
  }, [dragging, dragOver, moveNodeTo, moveNodesTo, selectedNodeIds]);

  const startDrag = useCallback((nodeId: string) => setDragging(nodeId), []);

  // ------------------------------------------------------------
  // マウスドラッグによる複数行の範囲選択
  // 同じ行の中でのドラッグはブラウザ標準のテキスト選択に任せ、
  // ドラッグが別の行をまたいだ瞬間だけノード単位の範囲選択(青ハイライト)に切り替える。
  // ------------------------------------------------------------
  const rangeAnchorRef = useRef<string | null>(null);
  const rangeActiveRef = useRef(false);

  const handleMouseDownCapture = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const targetEl = e.target as HTMLElement;
    // 行頭のドラッグハンドル(並べ替え用)からの開始は、そちらの処理に任せる
    if (targetEl.closest("[data-drag-handle]")) return;
    const row = targetEl.closest("[data-node-id]") as HTMLElement | null;
    rangeAnchorRef.current = row?.getAttribute("data-node-id") ?? null;
    rangeActiveRef.current = false;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (e.buttons !== 1 || !rangeAnchorRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest("[data-node-id]") as HTMLElement | null;
      if (!row) return;
      const overId = row.getAttribute("data-node-id")!;
      if (overId === rangeAnchorRef.current && !rangeActiveRef.current) return;
      if (!rangeActiveRef.current) {
        rangeActiveRef.current = true;
        document.body.classList.add("select-none");
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      selectRangeNodes(rangeAnchorRef.current, overId);
    },
    [selectRangeNodes]
  );

  useEffect(() => {
    function handleGlobalMouseUp() {
      rangeAnchorRef.current = null;
      rangeActiveRef.current = false;
      document.body.classList.remove("select-none");
    }
    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => document.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // ------------------------------------------------------------
  // 複数選択中のDelete/Backspace(一括削除)・Tab/Shift+Tab(一括インデント)
  // 個々のノードのkeydown処理より先に(capture段階で)割り込んで処理する
  // ------------------------------------------------------------
  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedNodeIds.length === 0) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        deleteNodesBulk(selectedNodeIds);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) outdentNodes(selectedNodeIds);
        else indentNodes(selectedNodeIds);
        return;
      }
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleCopyShortcut();
        return;
      }
      if (isMod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        handleCutShortcut();
      }
    },
    [selectedNodeIds, deleteNodesBulk, indentNodes, outdentNodes, handleCopyShortcut, handleCutShortcut]
  );

  // ------------------------------------------------------------
  // Undo/Redo: Ctrl/Cmd+Z(元に戻す)、Ctrl+Y または Ctrl/Cmd+Shift+Z(やり直す)
  // contenteditableのブラウザ標準Undoと衝突しないよう、ここでpreventDefaultして
  // 常にアプリ側のスナップショット履歴で処理する
  // ------------------------------------------------------------
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        useOutlineStore.getState().undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        useOutlineStore.getState().redo();
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  if (loading) {
    return <div className="py-16 text-center text-sm text-ink-400">読み込み中…</div>;
  }

  if (tree.length === 0) {
    return <div className="py-16 text-center text-sm text-ink-400">まだ何も書かれていません</div>;
  }

  return (
    <DndContext.Provider value={{ dragOver, startDrag }}>
      <div
        ref={containerRef}
        className="flex flex-col pb-56"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseDownCapture={handleMouseDownCapture}
        onMouseMove={handleMouseMove}
        onKeyDownCapture={handleKeyDownCapture}
        onCopy={handleCopy}
        onCut={handleCut}
        onPasteCapture={handlePasteCapture}
      >
        {tree.map((node) => (
          <OutlineNode key={node.id} node={node} depth={0} />
        ))}
      </div>
    </DndContext.Provider>
  );
}
