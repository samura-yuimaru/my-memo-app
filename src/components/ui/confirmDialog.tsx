"use client";

import { useEffect, useState } from "react";

// ============================================================
// アプリ内の確認ダイアログ。ブラウザ標準の window.confirm() は
// アプリの見た目から浮き、環境(PWA等)によって挙動もばらつくため置き換える。
// 使い方: const ok = await confirmDialog({ message, confirmLabel, danger });
// <ConfirmHost /> をアプリのどこかに1つだけ常設しておくこと。
// ============================================================

export interface ConfirmOptions {
  message: string;
  /** 実行ボタンのラベル(既定: 「OK」) */
  confirmLabel?: string;
  /** キャンセルボタンのラベル(既定: 「キャンセル」) */
  cancelLabel?: string;
  /** 破壊的操作として実行ボタンを赤系で表示する */
  danger?: boolean;
}

interface PendingRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let notify: ((req: PendingRequest | null) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!notify) {
      // ホストが未マウント(想定外)。安全側に倒してキャンセル扱いにする
      resolve(false);
      return;
    }
    notify({ ...opts, resolve });
  });
}

/** アプリに1つだけ常設する。確認ダイアログの実体をここで描画する。 */
export function ConfirmHost() {
  const [req, setReq] = useState<PendingRequest | null>(null);

  useEffect(() => {
    notify = setReq;
    return () => {
      notify = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        req!.resolve(false);
        setReq(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;

  const done = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-900/40 p-4"
      onClick={() => done(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{req.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => done(false)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100"
          >
            {req.cancelLabel ?? "キャンセル"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => done(true)}
            className={
              req.danger
                ? "rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
                : "rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-600"
            }
          >
            {req.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
