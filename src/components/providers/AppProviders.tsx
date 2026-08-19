"use client";

import { useEffect } from "react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { LoginScreen } from "@/components/auth/LoginScreen";

/**
 * アプリ起動時に一度だけ同期エンジンを初期化する
 * (既存セッションの確認・IndexedDBオープン・メモ一覧の読み込み・保留中の同期のフラッシュ)。
 *
 * Supabaseが設定されていて、かつ有効なログインセッションが無い場合は、アプリ本体の
 * 代わりにログイン画面を表示する(PC⇄iPad等の複数端末で同じアカウントとしてログイン
 * して初めて、お互いのデータが同期されるため)。Supabase未設定(ローカル専用モード)の
 * 場合はログインの概念自体が無いため、常にそのままアプリ本体を表示する。
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const init = useOutlineStore((s) => s.init);
  const supabaseReady = useOutlineStore((s) => s.supabaseReady);
  const authChecked = useOutlineStore((s) => s.authChecked);
  const userId = useOutlineStore((s) => s.userId);

  useEffect(() => {
    void init();
  }, [init]);

  if (!supabaseReady) return <>{children}</>;
  // 起動直後、既存セッションの確認が終わるまでは何も出さない
  // (ログイン画面とアプリ本体、どちらか一瞬だけ誤って見えてしまうちらつきを防ぐ)
  if (!authChecked) return null;
  if (!userId) return <LoginScreen />;

  return <>{children}</>;
}
