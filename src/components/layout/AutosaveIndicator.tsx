"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { Popover } from "@/components/ui/Popover";

/**
 * 画面隅に常駐する「データ保護ステータス」の☑マーク。タップすると、最終同期時刻の確認と
 * JSONでの書き出し/読み込み(バックアップ・機種変更時の引き継ぎ)ができるパネルを開く。
 * 色でひと目に状態がわかるようにしている:
 *   緑チェック = 保護済み(保存/同期済み) / 青回転 = 同期中 / 黄色 = オフライン(端末には保存済み) / 赤 = エラー
 */
export function AutosaveIndicator() {
  const syncStatus = useOutlineStore((s) => s.syncStatus);
  const supabaseReady = useOutlineStore((s) => s.supabaseReady);
  const isOnline = useOutlineStore((s) => s.isOnline);
  const lastSyncedAt = useOutlineStore((s) => s.lastSyncedAt);
  const exportSnapshot = useOutlineStore((s) => s.exportSnapshot);
  const importSnapshot = useOutlineStore((s) => s.importSnapshot);

  const [open, setOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const view = (() => {
    if (syncStatus === "saving") {
      return {
        icon: <Loader2 size={16} className="animate-spin" />,
        label: "同期中…",
        detail: "クラウドへ保存しています",
        className: "text-sky-600 dark:text-sky-300",
      };
    }
    if (syncStatus === "error") {
      return {
        icon: <AlertTriangle size={16} />,
        label: "同期エラー",
        detail: "端末には保存済みです。オンラインになると自動的に再送されます",
        className: "text-rose-600 dark:text-rose-300",
      };
    }
    if (!supabaseReady) {
      return {
        icon: <CheckCircle2 size={16} />,
        label: "端末に保護済み(ローカル)",
        detail: "Supabase未接続のため、この端末のみに自動保存されています",
        className: "text-emerald-600 dark:text-emerald-300",
      };
    }
    if (!isOnline) {
      return {
        icon: <AlertTriangle size={16} />,
        label: "オフライン",
        detail: "端末には保存済み。オンラインに戻ると自動的に同期されます",
        className: "text-amber-500 dark:text-amber-300",
      };
    }
    return {
      icon: <CheckCircle2 size={16} />,
      label: "保護されています",
      detail: "端末とクラウドの両方に自動保存・同期済みです",
      className: "text-emerald-600 dark:text-emerald-300",
    };
  })();

  const lastSyncedLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("ja-JP", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "まだ同期していません";

  async function handleExport() {
    const snapshot = await exportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `my-memo-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    setImportMessage(null);
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await importSnapshot(data);
      setImportMessage(
        `読み込み完了: フォルダ${result.folders}件・メモ${result.notes}件・行${result.nodes}件`
      );
    } catch (err) {
      setImportMessage(
        `読み込みに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        title={`${view.label}(タップで詳細)`}
        aria-label={`${view.label}(タップで詳細)`}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-ink-100",
          view.className
        )}
      >
        {view.icon}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} className="md:right-0 md:top-full md:mt-1 md:w-72">
        <div className="flex flex-col gap-3 p-1">
          <div>
            <div className={clsx("flex items-center gap-1.5 text-sm font-semibold", view.className)}>
              {view.icon}
              {view.label}
            </div>
            <p className="mt-1 text-xs text-ink-500">{view.detail}</p>
          </div>

          <div className="rounded-lg bg-ink-50 px-2.5 py-2 text-xs text-ink-600 dark:bg-ink-800">
            最終同期: <span className="font-medium text-ink-800">{lastSyncedLabel}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => void handleExport()}
              className="flex items-center gap-2 rounded-md border border-ink-200 px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              <Download size={15} /> JSONで書き出す(バックアップ)
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={handleImportClick}
              className="flex items-center gap-2 rounded-md border border-ink-200 px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:hover:bg-ink-800"
            >
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              JSONを読み込む(復元・引き継ぎ)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => void handleImportFile(e)}
            />
            {importMessage && <p className="text-xs text-ink-500">{importMessage}</p>}
          </div>
        </div>
      </Popover>
    </div>
  );
}
