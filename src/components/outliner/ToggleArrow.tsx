"use client";

import { ChevronRight } from "lucide-react";
import clsx from "clsx";

interface ToggleArrowProps {
  hasChildren: boolean;
  collapsed: boolean;
}

/**
 * 行頭アイコン(見た目専用・クリック/ドラッグの実処理は親のOutlineNode側で行う)。
 * ・子を持つノード: 「＞」矢印(展開中は90度回転して下向きになる)
 * ・子を持たない末端のノード: 「・」箇条書きドット
 * 数値バッジ等の装飾は付けず、文字(記号)のみのシンプルな表示にする。
 */
export function ToggleArrow({ hasChildren, collapsed }: ToggleArrowProps) {
  if (!hasChildren) {
    return (
      <span className="pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="block h-1.5 w-1.5 rounded-full bg-ink-400" />
      </span>
    );
  }

  return (
    <span
      className="pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center text-ink-400"
      aria-hidden="true"
    >
      <ChevronRight
        size={15}
        strokeWidth={2.5}
        className={clsx("transition-transform duration-150", !collapsed && "rotate-90")}
      />
    </span>
  );
}
