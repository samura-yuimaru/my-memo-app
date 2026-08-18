"use client";

import { createContext, useContext } from "react";

export type SidebarDragItem = { type: "note" | "folder"; id: string };

interface SidebarDndContextValue {
  draggingItem: SidebarDragItem | null;
  /** 現在ドラッグ中のアイテムを乗せられる場所: フォルダid、または"unfiled"(フォルダなしエリア) */
  dropTarget: string | null;
  startDragNote: (id: string) => void;
  startDragFolder: (id: string) => void;
}

export const SidebarDndContext = createContext<SidebarDndContextValue | null>(null);

export function useSidebarDnd(): SidebarDndContextValue {
  const ctx = useContext(SidebarDndContext);
  if (!ctx) {
    throw new Error("useSidebarDndはSidebarDndContext.Providerの内側でのみ使用できます");
  }
  return ctx;
}
