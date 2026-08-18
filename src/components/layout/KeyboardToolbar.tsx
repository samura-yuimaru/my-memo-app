"use client";

import { useEffect, useState } from "react";
import { ChevronsRight, CornerDownLeft } from "lucide-react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";

function isEditableElement(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.isContentEditable;
}

/**
 * iPad/スマホでソフトウェアキーボードが表示されている間だけ、キーボードのすぐ上に
 * 固定表示されるミニツールバー。画面最下部固定のMobileToolbarは、キーボード表示中は
 * その下に隠れてしまう(iOS Safariはキーボード表示時にレイアウトビューポート自体は
 * 縮めないため、position:sticky/fixedをbottom:0にしても画面外に取り残される)。
 * そこでwindow.visualViewportの高さを監視し、キーボードの上端の実際の位置に
 * 追従させることで、常に指の届く位置に「インデント(＞＞)」「改行して次の行へ(↲)」を
 * 表示し続ける。
 */
export function KeyboardToolbar() {
  const currentNoteId = useOutlineStore((s) => s.currentNoteId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const indentNode = useOutlineStore((s) => s.indentNode);

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

  function insertNewline() {
    // 既存のEnterキー処理(NodeEditorのhandleKeyDown)をそのまま再利用するため、
    // 実際のkeydownイベントをフォーカス中の編集欄へ発行する(キャレット位置の計算等を
    // ここで重複実装しないため)
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
  }

  // ボタン押下でフォーカス(とキャレット位置)を失わないよう、pointerdown時点で既定動作を止める
  function preserveFocus(e: React.PointerEvent) {
    e.preventDefault();
  }

  return (
    <div
      className="fixed inset-x-0 z-30 flex items-center justify-end gap-1 border-t border-ink-200 bg-surface-alt/95 px-2 py-1.5 shadow-[0_-1px_6px_rgba(0,0,0,0.06)] backdrop-blur"
      style={{ bottom: keyboardInset }}
    >
      <button
        type="button"
        onPointerDown={preserveFocus}
        onClick={() => activeNodeId && indentNode(activeNodeId)}
        title="インデントを下げる(1つ上の子にする)"
        aria-label="インデントを下げる"
        className="flex h-9 min-w-[2.75rem] items-center justify-center rounded-md px-2 text-ink-600 hover:bg-ink-100 active:bg-ink-200"
      >
        <ChevronsRight size={19} />
      </button>
      <span className="h-6 w-px shrink-0 bg-ink-200" aria-hidden="true" />
      <button
        type="button"
        onPointerDown={preserveFocus}
        onClick={insertNewline}
        title="改行して次の行へ"
        aria-label="改行して次の行へ"
        className="flex h-9 min-w-[2.75rem] items-center justify-center rounded-md px-2 text-ink-600 hover:bg-ink-100 active:bg-ink-200"
      >
        <CornerDownLeft size={19} />
      </button>
    </div>
  );
}
