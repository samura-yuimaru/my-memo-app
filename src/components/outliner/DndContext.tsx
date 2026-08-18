"use client";

import { createContext, useContext } from "react";

export interface DragOverState {
  draggingId: string;
  overId: string;
  /** "into"は対象ノードの子として直接入れ込む(スマート構造化ブロック内への出し入れもこれで行う) */
  position: "before" | "after" | "into";
}

interface DndContextValue {
  dragOver: DragOverState | null;
  /** Bulletのpointerdownから呼ぶ。ドラッグ対象として登録する */
  startDrag: (nodeId: string) => void;
}

export const DndContext = createContext<DndContextValue | null>(null);

export function useDnd(): DndContextValue {
  const ctx = useContext(DndContext);
  if (!ctx) {
    throw new Error("useDndはDndContext.Providerの内側でのみ使用できます");
  }
  return ctx;
}
