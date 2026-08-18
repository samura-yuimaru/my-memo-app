"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /**
   * md(768px)以上での位置指定に使う。すべて "md:" 接頭辞を付けて渡すこと
   * (例: "md:right-0 md:top-full md:mt-1 md:w-64")。
   * md未満(iPad縦向きのSplit View・スマホ等)では常に画面下部のボトムシートとして
   * 表示するため無視される。
   */
  className?: string;
  children: React.ReactNode;
}

/**
 * 軽量ポップオーバー。外側クリック/Escapeで閉じる。
 * 狭い画面(iPad縦向きのSplit View・スマホ)では、はみ出して押せなくなるのを防ぐため
 * 画面下部に張り付くボトムシートとして表示し、md(768px)以上では呼び出し側指定の位置に
 * 浮かぶ通常のドロップダウンとして表示する。iPad縦向き(744〜834px前後)はmd未満〜直後の
 * 境界にあたるため、ここは広めに倒してボトムシート側を優先している。
 */
export function Popover({ open, onClose, className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-ink-900/30 md:hidden"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={ref}
        className={clsx(
          // md未満: 画面下部に張り付くシート形式(横幅は常に画面内に収まる)
          "fixed inset-x-3 bottom-3 z-40 max-h-[70vh] overflow-y-auto rounded-2xl border border-ink-200 bg-surface-alt p-3 shadow-panel",
          // md以上: 呼び出し側が指定する位置に浮かぶ通常のドロップダウン
          "md:absolute md:inset-x-auto md:bottom-auto md:z-30 md:max-h-none md:overflow-visible md:rounded-lg md:p-2",
          className
        )}
      >
        {children}
      </div>
    </>
  );
}
