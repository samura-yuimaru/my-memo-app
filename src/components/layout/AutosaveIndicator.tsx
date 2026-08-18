"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, HardDrive, Loader2, RefreshCw, Upload } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { Popover } from "@/components/ui/Popover";

/** 「○分前」/ 今日の時刻(HH:mm:ss)で最終同期時刻を表す */
function formatLastSynced(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  return new Date(iso).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 画面隅に常駐する「データ保護ステータス」の☑マーク。タップすると、最終同期時刻の確認と
 * JSONでの書き出し/読み込み(バックアップ・機種変更時の引き継ぎ)ができるパネルを開く。
 *
 * 表示状態は、次のすべてが一致してはじめて「クラウド同期済み」を名乗る:
 *   1) Supabaseが設定されている(supabaseReady)
 *   2) 匿名認証セッションが確立している(userId が非null = isAnonymousなユーザーとして認証済み)
 *   3) オンラインである(isOnline)
 *   4) 実際に書き込みが完了している(syncStatusが"saving"/"error"ではなく、
 *      ローカルの未送信キューが0件 = pendingCount === 0)
 * これらのどれか一つでも欠けている間は、絶対に緑の「クラウド同期済み」を名乗らない
 * (以前は supabaseReady と userId の状態を見ずに緑チェックを出してしまい、
 *  「緑なのに端末保存のみ/未同期」という表示の不整合が起きていたための修正)。
 *
 * 色: 緑=クラウド同期済み / 青回転=同期中・接続中 / 黄=オフライン / 赤=同期エラー /
 *     グレー=Supabase未設定(端末のみ、クラウド同期の対象外)
 */
export function AutosaveIndicator() {
  const syncStatus = useOutlineStore((s) => s.syncStatus);
  const supabaseReady = useOutlineStore((s) => s.supabaseReady);
  const isOnline = useOutlineStore((s) => s.isOnline);
  const userId = useOutlineStore((s) => s.userId);
  const reconnecting = useOutlineStore((s) => s.reconnecting);
  const reconnectSupabase = useOutlineStore((s) => s.reconnectSupabase);
  const lastSyncedAt = useOutlineStore((s) => s.lastSyncedAt);
  const pendingCount = useOutlineStore((s) => s.pendingCount);
  const refreshPendingCount = useOutlineStore((s) => s.refreshPendingCount);
  const exportSnapshot = useOutlineStore((s) => s.exportSnapshot);
  const importSnapshot = useOutlineStore((s) => s.importSnapshot);

  const [open, setOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ローカルの未送信キュー件数は他タブでの操作等でも変わり得るため、パネルを開いている間・
  // マウント中は定期的に数え直して実態と表示がずれないようにする
  useEffect(() => {
    void refreshPendingCount();
    const timer = window.setInterval(() => void refreshPendingCount(), 4000);
    return () => window.clearInterval(timer);
  }, [refreshPendingCount]);

  const connected = supabaseReady && !!userId;
  // Supabase自体は設定済みなのに、匿名認証がまだ通っていない(またはエラー状態)の場合に、
  // ワンタップで再接続できるボタンをモーダル内に出す
  const showReconnect = supabaseReady && !reconnecting && (syncStatus === "error" || !userId);

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
        icon: <HardDrive size={16} />,
        label: "端末のみに保存(ローカル専用)",
        detail: "Supabase未設定のため、この端末のみに自動保存されています",
        className: "text-ink-500",
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
    if (!userId || reconnecting) {
      return {
        icon: <Loader2 size={16} className="animate-spin" />,
        label: "Supabaseに接続中…",
        detail: "匿名認証セッションを確立しています",
        className: "text-sky-600 dark:text-sky-300",
      };
    }
    if (pendingCount > 0) {
      return {
        icon: <Loader2 size={16} className="animate-spin" />,
        label: "同期中…",
        detail: `クラウドへの送信待ちが${pendingCount}件あります`,
        className: "text-sky-600 dark:text-sky-300",
      };
    }
    return {
      icon: <CheckCircle2 size={16} />,
      label: "クラウド同期済み(Supabase)",
      detail: "端末とSupabaseの両方に自動保存・同期済みです",
      className: "text-emerald-600 dark:text-emerald-300",
    };
  })();

  const lastSyncedLabel =
    connected && lastSyncedAt ? formatLastSynced(lastSyncedAt) : "まだ同期していません";

  async function handleExport() {
    const snapshot = await exportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `outliner-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleReconnect() {
    setReconnectMessage(null);
    const ok = await reconnectSupabase();
    setReconnectMessage(ok ? "Supabaseに接続しました" : "接続できませんでした。もう一度お試しください");
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
            <p className="mt-1 text-xs text-ink-600">{view.detail}</p>
          </div>

          <div className="rounded-lg bg-ink-100 px-2.5 py-2 text-xs text-ink-600">
            最終同期: <span className="font-medium text-ink-900">{lastSyncedLabel}</span>
          </div>

          {showReconnect && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={reconnecting}
                onClick={() => void handleReconnect()}
                className="flex items-center gap-2 rounded-md bg-accent-500 px-2.5 py-2 text-left text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
              >
                {reconnecting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Supabaseに手動接続/再試行
              </button>
              {reconnectMessage && <p className="text-xs text-ink-500">{reconnectMessage}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => void handleExport()}
              className="flex items-center gap-2 rounded-md border border-ink-200 px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
            >
              <Download size={15} /> JSONで書き出す(バックアップ)
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={handleImportClick}
              className="flex items-center gap-2 rounded-md border border-ink-200 px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50"
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
