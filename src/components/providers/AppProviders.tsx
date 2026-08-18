"use client";

import { useEffect } from "react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";

/**
 * アプリ起動時に一度だけ同期エンジンを初期化する
 * (匿名認証の確保・IndexedDBオープン・メモ一覧の読み込み・保留中の同期のフラッシュ)。
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const init = useOutlineStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return <>{children}</>;
}
