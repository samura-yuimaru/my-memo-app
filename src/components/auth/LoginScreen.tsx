"use client";

import { useState } from "react";
import { Loader2, Lock, Mail } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";

type Mode = "signIn" | "signUp";

/**
 * 未ログイン状態(Supabaseは設定済みだが有効なセッションが無い)のときにアプリ全体の
 * 代わりに表示するログイン/新規登録画面。PC⇄iPad(複数端末)間で同じアカウントとして
 * ログインすることで、初めてクラウド同期が「同じデータ」を指すようになる
 * (匿名認証は端末ごとに別ユーザーになってしまうため、このアプリでは使わない)。
 */
export function LoginScreen() {
  const signIn = useOutlineStore((s) => s.signIn);
  const signUp = useOutlineStore((s) => s.signUp);
  const authenticating = useOutlineStore((s) => s.authenticating);

  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (mode === "signIn") {
      const result = await signIn(email, password);
      if (result.error) setError(result.error);
      return;
    }

    const result = await signUp(email, password);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.needsEmailConfirmation) {
      setInfoMessage("確認メールを送信しました。メール内のリンクを開いてから、ログインしてください。");
      setMode("signIn");
      return;
    }
  }

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-surface px-4 text-ink-800">
      <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-surface p-6 shadow-panel">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <svg viewBox="0 0 24 24" width={40} height={40} className="rounded-[9px] shadow-sm" aria-hidden="true">
            <rect width={24} height={24} rx={5.5} fill="#3c66ea" />
            <rect x={6} y={8.5} width={12} height={2} rx={1} fill="#ffffff" />
            <rect x={6} y={12} width={9} height={2} rx={1} fill="#ffffff" />
            <rect x={6} y={15.5} width={6} height={2} rx={1} fill="#ffffff" />
          </svg>
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">OutLiner</h1>
          <p className="text-sm text-ink-500">
            {mode === "signIn"
              ? "ログインして、他の端末と同じメモを見る"
              : "アカウントを作成して、複数端末で同期する"}
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink-600">
            メールアドレス
            <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2 focus-within:border-accent-400">
              <Mail size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="min-w-0 flex-1 bg-transparent text-base text-ink-800 outline-none"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1 text-sm text-ink-600">
            パスワード
            <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2 focus-within:border-accent-400">
              <Lock size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6文字以上"
                className="min-w-0 flex-1 bg-transparent text-base text-ink-800 outline-none"
              />
            </div>
          </label>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}
          {infoMessage && (
            <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700 dark:bg-accent-500/10 dark:text-accent-300">
              {infoMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={authenticating}
            className={clsx(
              "mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-3 py-2.5 text-base font-semibold text-white shadow-sm hover:bg-accent-600",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {authenticating && <Loader2 size={16} className="animate-spin" />}
            {mode === "signIn" ? "ログイン" : "アカウントを作成"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "signIn" ? "signUp" : "signIn"));
            setError(null);
            setInfoMessage(null);
          }}
          className="mt-4 w-full text-center text-sm text-accent-600 hover:underline"
        >
          {mode === "signIn" ? "アカウントをお持ちでない方はこちら" : "既にアカウントをお持ちの方はこちら"}
        </button>
      </div>
    </div>
  );
}
