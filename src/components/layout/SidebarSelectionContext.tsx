"use client";

import { createContext, useContext } from "react";
import type { SidebarItemKey } from "@/lib/store/useOutlineStore";

interface PressModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface SidebarSelectionContextValue {
  /** 「選択モード」中かどうか(iPad/スマホ向けのチェックボックス表示切り替えボタン用) */
  selectionMode: boolean;
  isSelected: (type: SidebarItemKey["type"], id: string) => boolean;
  hasSelection: boolean;
  /**
   * フォルダ/メモ行が押された際に呼ぶ。選択操作として消費した場合はtrueを返す
   * (呼び出し側は通常の「開く/折りたたみ」処理を行わない)。
   * - selectionMode中、またはCtrl/Cmd押下: そのアイテムだけをトグル
   * - Shift押下: 直前に選択操作したアイテムから、画面表示順で範囲選択
   * - それ以外: 既存の選択があれば解除するだけ(通常操作はそのまま行わせる)
   */
  handleItemPress: (type: SidebarItemKey["type"], id: string, modifiers: PressModifiers) => boolean;
}

export const SidebarSelectionContext = createContext<SidebarSelectionContextValue | null>(null);

export function useSidebarSelection(): SidebarSelectionContextValue {
  const ctx = useContext(SidebarSelectionContext);
  if (!ctx) {
    throw new Error("useSidebarSelectionはSidebarSelectionContext.Providerの内側でのみ使用できます");
  }
  return ctx;
}
