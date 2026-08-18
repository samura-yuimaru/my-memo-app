"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
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
  const selectRangeNodes = useOutlineStore((s) => s.selectRangeNodes);
  const deleteNodesBulk = useOutlineStore((s) => s.deleteNodesBulk);
  const indentNodes = useOutlineStore((s) => s.indentNodes);
  const outdentNodes = useOutlineStore((s) => s.outdentNodes);

  const tree = useMemo(() => buildTree(Object.values(nodes)), [nodes]);

  // メモ全体を選択している間(Notion風の2段階Ctrl+A、またはマウスドラッグでの範囲選択)は、
  // コピーをブラウザ標準のテキスト選択ではなく、階層をインデントで表したプレーンテキストとして書き出す
  const handleCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (selectedNodeIds.length === 0) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", buildPlainTextOutline(tree));
    },
    [selectedNodeIds, tree]
  );

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
      }
    },
    [selectedNodeIds, deleteNodesBulk, indentNodes, outdentNodes]
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
        className="flex flex-col pb-56"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseDownCapture={handleMouseDownCapture}
        onMouseMove={handleMouseMove}
        onKeyDownCapture={handleKeyDownCapture}
        onCopy={handleCopy}
      >
        {tree.map((node) => (
          <OutlineNode key={node.id} node={node} depth={0} />
        ))}
      </div>
    </DndContext.Provider>
  );
}
