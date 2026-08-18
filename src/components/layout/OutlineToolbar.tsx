"use client";

import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight, CornerDownLeft, CornerDownRight } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";

function isEditableElement(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.isContentEditable;
}

/**
 * アウトライン操作用のツールバー(≪インデント解除・≫インデント・↲元に戻す・↳やり直す)。
 * ソフトウェアキーボードの表示有無に関わらず、常に「同一のコンポーネント・同一のボタン定義・
 * 同一のイベント処理」を描画する一元化された設計にしている(以前はキーボード表示中の
 * 浮遊ツールバーと非表示中の標準操作バーとで、KeyboardToolbar/MobileToolbarという
 * 別々のコンポーネント・別ロジックが存在しており、ボタン構成や挙動が微妙に食い違っていた)。
 * 状態によって変わるのは「位置」だけ:
 *   - キーボード非表示時: 画面下部に固定表示(sticky bottom-0)。PCでもクリックで使える
 *   - キーボード表示時  : window.visualViewportで検出したキーボードの上端に浮遊追従(fixed)
 * インデント操作は「現在フォーカス/選択中のノード」(activeNodeId)に対して行い、
 * Undo/Redoは編集中のテキストも含むuseOutlineStoreのノード操作履歴と直結する。
 */
export function OutlineToolbar() {
  const currentNoteId = useOutlineStore((s) => s.currentNoteId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const indentNode = useOutlineStore((s) => s.indentNode);
  const outdentNode = useOutlineStore((s) => s.outdentNode);
  const undo = useOutlineStore((s) => s.undo);
  const redo = useOutlineStore((s) => s.redo);
  const canUndo = useOutlineStore((s) => s.undoStack.length > 0);
  const canRedo = useOutlineStore((s) => s.redoStack.length > 0);

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

  // visualViewportの高さからソフトウェアキーボードの高さを推定する
  // (iOS Safariはキーボード表示時にレイアウトビューポート自体は縮めないため、
  //  sticky/fixedをbottom:0のままにしているとキーボードの下に隠れてしまう)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    function update() {
      if (!vv) return;
      setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  if (!currentNoteId) return null;

  const noSelection = !activeNodeId;
  // ソフトウェアキーボードが実際に開いている(=一定以上の高さがある)、かつ編集中の場合だけ
  // 浮遊表示に切り替える。外付けキーボード使用時は自然にfalseのままになる
  const keyboardVisible = editingFocused && keyboardInset >= 80;

  // ボタン押下でフォーカス(とキャレット位置)を失わないよう、pointerdown時点で既定動作を止める
  function preserveFocus(e: React.PointerEvent) {
    e.preventDefault();
  }

  const buttons: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }[] = [
    {
      label: "インデント解除(親と同じ階層に戻す)",
      icon: <ChevronsLeft size={19} />,
      onClick: () => activeNodeId && outdentNode(activeNodeId),
      disabled: noSelection,
    },
    {
      label: "インデントを下げる(1つ上の子にする)",
      icon: <ChevronsRight size={19} />,
      onClick: () => activeNodeId && indentNode(activeNodeId),
      disabled: noSelection,
    },
    {
      label: "元に戻す",
      icon: <CornerDownLeft size={19} />,
      onClick: () => undo(),
      disabled: !canUndo,
    },
    {
      label: "やり直す",
      icon: <CornerDownRight size={19} />,
      onClick: () => redo(),
      disabled: !canRedo,
    },
  ];

  return (
    <div
      className={clsx(
        "z-30 flex items-center justify-center gap-1 border-t border-ink-200 bg-surface-alt/95 px-2 py-1.5 backdrop-blur",
        keyboardVisible ? "fixed inset-x-0 shadow-[0_-1px_6px_rgba(0,0,0,0.06)]" : "sticky bottom-0"
      )}
      style={
        keyboardVisible
          ? { bottom: keyboardInset }
          : { paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }
      }
    >
      {buttons.map((b) => (
        <IconButton
          key={b.label}
          label={b.label}
          size="lg"
          disabled={b.disabled}
          onPointerDown={preserveFocus}
          onClick={b.onClick}
        >
          {b.icon}
        </IconButton>
      ))}
    </div>
  );
}
