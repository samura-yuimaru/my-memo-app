"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * デプロイで新しいバージョンが出ているのに、古いタブ(特にiPadのホーム画面アプリ)が
 * 古いコードを保持し続けてしまう問題への対処。
 *
 * 仕組み: ウィンドウにフォーカスが戻ったタイミング(と初回)で、キャッシュを無視して
 * トップページのHTMLを取得し、そこに埋め込まれているNext.jsのbuildIdを、今動いている
 * ページのbuildIdと比べる。違っていれば「新しいバージョンがあります」の細いバーを出し、
 * タップすると再読み込みする。オフライン時はfetchが失敗するだけで、誤検知はしない。
 */
export function UpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const lastCheckRef = useRef(0);

  const check = useCallback(async () => {
    if (updateReady) return;
    // 連続フォーカスでの過剰なリクエストを避ける(最短5分間隔)
    const now = Date.now();
    if (now - lastCheckRef.current < 5 * 60 * 1000) return;
    lastCheckRef.current = now;

    const current =
      typeof window !== "undefined"
        ? (window as unknown as { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__?.buildId
        : undefined;
    if (!current || current === "development") return;

    try {
      const res = await fetch(`/?_v=${now}`, { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.text();
      const m = html.match(/"buildId":"([^"]+)"/);
      if (m && m[1] && m[1] !== current) setUpdateReady(true);
    } catch {
      // オフライン等。何もしない(誤って更新バーを出さない)
    }
  }, [updateReady]);

  useEffect(() => {
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  if (!updateReady) return null;

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="flex w-full items-center justify-center gap-2 bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600"
    >
      <RefreshCw size={14} />
      新しいバージョンがあります。タップで更新
    </button>
  );
}
