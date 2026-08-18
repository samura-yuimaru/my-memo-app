"use client";

import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";

/**
 * 画面隅に常駐する自動保存インジケーター。エクスポート操作が不要なことの安心材料。
 * 階層構造の視認性を最優先するため、常にアイコン1つだけの最小表示にとどめ、
 * 詳しいラベルはツールチップ(title)でのみ確認できるようにしている。
 */
export function AutosaveIndicator() {
  const syncStatus = useOutlineStore((s) => s.syncStatus);
  const supabaseReady = useOutlineStore((s) => s.supabaseReady);
  const isOnline = useOutlineStore((s) => s.isOnline);

  const view = (() => {
    if (syncStatus === "saving") {
      return {
        icon: <Loader2 size={14} className="animate-spin" />,
        label: "保存中…",
        className: "text-ink-500",
      };
    }
    if (syncStatus === "error") {
      return {
        icon: <AlertTriangle size={14} />,
        label: "同期エラー(端末には保存済み)",
        className: "text-rose-600 dark:text-rose-300",
      };
    }
    if (!supabaseReady) {
      return {
        icon: <CheckCircle2 size={14} />,
        label: "端末に自動保存済み(ローカル)",
        className: "text-emerald-600 dark:text-emerald-300",
      };
    }
    if (!isOnline) {
      return {
        icon: <CloudOff size={14} />,
        label: "オフライン・端末に保存済み",
        className: "text-amber-600 dark:text-amber-300",
      };
    }
    return {
      icon: <CheckCircle2 size={14} />,
      label: "自動保存済み",
      className: "text-emerald-600 dark:text-emerald-300",
    };
  })();

  return (
    <div
      title={view.label}
      aria-label={view.label}
      className={clsx("flex h-9 w-9 shrink-0 items-center justify-center", view.className)}
    >
      {view.icon}
    </div>
  );
}
