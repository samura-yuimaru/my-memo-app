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

  // オフライン起動対応(iPad等でネットが無い状態でアプリのアイコンを開いても、
  // 真っ白/エラー画面にならず外枠だけは表示できるようにする)。
  // 開発中はホットリロードと相性が悪いため本番ビルドでのみ登録する。
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録に失敗しても致命的ではない(オフライン起動が効かないだけで、
      // オンライン時の通常の動作には影響しない)
    });
  }, []);

  if (!supabaseReady) return <>{children}</>;
  // 起動直後、既存セッションの確認が終わるまでは何も出さない
  // (ログイン画面とアプリ本体、どちらか一瞬だけ誤って見えてしまうちらつきを防ぐ)
  if (!authChecked) return null;
  if (!userId) return <LoginScreen />;

  return <>{children}</>;
}
