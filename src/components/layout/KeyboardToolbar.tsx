"use client";

import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight, CornerDownLeft, CornerDownRight } from "lucide-react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";

function isEditableElement(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.isContentEditable;
}

/** フォーカス中の編集欄へ実際のkeydownイベントを発行する。既存のNodeEditorのキー処理
 *  (Enter=兄弟ノード追加、Tab=インデント)をそのまま再利用し、キャレット位置計算等を
 *  ここで重複実装しないための共通ヘルパー */
function dispatchKey(key: string, shiftKey = false): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })
  );
}

/**
 * iPad/スマホでソフトウェアキーボードが表示されている間だけ、キーボードのすぐ上に
 * 固定表示されるミニツールバー。画面最下部固定のMobileToolbarは、キーボード表示中は
 * その下に隠れてしまう(iOS Safariはキーボード表示時にレイアウトビューポート自体は
 * 縮めないため、position:fixedをbottom:0にしても画面外に取り残される)。
 * そこでwindow.visualViewportの高さを監視し、キーボードの上端の実際の位置に追従させる。
 *
 * ボタンは中央揃えで次の4つのみ:
 *   << インデント解除(親と同じ階層に戻す) / >> インデントを下げる(子にする)
 *   ↲ 改行(同じ階層に新しいノードを追加) / ↳ 子ノードを作成(1段深い新しいノードを追加)
 */
export function KeyboardToolbar() {
  const currentNoteId = useOutlineStore((s) => s.currentNoteId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const indentNode = useOutlineStore((s) => s.indentNode);
  const outdentNode = useOutlineStore((s) => s.outdentNode);

  const [editingFocused, setEditingFocused] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  // 現在フォーカスがノード編集欄(contentEditable)にあるかどうかを追跡する
  useEffect(() => {
    function handleFocusIn(e: FocusEvent) {
      if (isEditableElement(e.target as Element | null)) setEditingFocused(true);
    }
    function handleFocusOut() {
      // フォーカスが次の編集欄へ移る場合の一瞬のちらつきを避けるため、次のtickで確認する
      window.setTimeout(() => {
        if (!isEditableElement(document.activeElement)) setEditingFocused(false);
      }, 0);
    }
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  // visualViewportの高さからソフトウェアキーボードの高さを推定し、
  // ツールバーをちょうどキーボードの上端に位置させる
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    function update() {
      if (!vv) return;
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // ソフトウェアキーボードが実際に開いている(=一定以上の高さがある)、かつ
  // ノードを編集中の場合のみ表示する。外付けキーボード使用時は自然に表示されない
  if (!currentNoteId || !activeNodeId || !editingFocused || keyboardInset < 80) return null;

  function insertSiblingNode() {
    dispatchKey("Enter");
  }

  function insertChildNode() {
    // Enter(兄弟ノード追加)→ 新しいノードへフォーカスが移った直後にTab(インデント)を
    // 発行することで「子ノードの作成」にする。フォーカス移動はNodeEditorのfocusRequest
    // エフェクト経由で行われるため、レンダー確定後に発行されるよう1tick遅らせる
    dispatchKey("Enter");
    window.setTimeout(() => dispatchKey("Tab"), 0);
  }

  // ボタン押下でフォーカス(とキャレット位置)を失わないよう、pointerdown時点で既定動作を止める
  function preserveFocus(e: React.PointerEvent) {
    e.preventDefault();
  }

  const buttons: { label: string; icon: React.ReactNode; onClick: () => void }[] = [
    {
      label: "インデント解除(親と同じ階層に戻す)",
      icon: <ChevronsLeft size={19} />,
      onClick: () => activeNodeId && outdentNode(activeNodeId),
    },
    {
      label: "インデントを下げる(1つ上の子にする)",
      icon: <ChevronsRight size={19} />,
      onClick: () => activeNodeId && indentNode(activeNodeId),
    },
    {
      label: "改行(同じ階層に新しいノードを追加)",
      icon: <CornerDownLeft size={19} />,
      onClick: insertSiblingNode,
    },
    {
      label: "子ノードを作成",
      icon: <CornerDownRight size={19} />,
      onClick: insertChildNode,
    },
  ];

  return (
    <div
      className="fixed inset-x-0 z-30 flex items-center justify-center gap-1 border-t border-ink-200 bg-surface-alt/95 px-2 py-1.5 shadow-[0_-1px_6px_rgba(0,0,0,0.06)] backdrop-blur"
      style={{ bottom: keyboardInset }}
    >
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          onPointerDown={preserveFocus}
          onClick={b.onClick}
          title={b.label}
          aria-label={b.label}
          className="flex h-9 min-w-[2.75rem] items-center justify-center rounded-md px-2 text-ink-600 hover:bg-ink-100 active:bg-ink-200"
        >
          {b.icon}
        </button>
      ))}
    </div>
  );
}
