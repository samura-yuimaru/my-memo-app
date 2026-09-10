"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * デプロイで新しいバージョンが出ているのに、古いタブ(特に iPad のホーム画面アプリ)が
 * 古いコードを保持し続けてしまう問題への対処。
 *
 * ウィンドウにフォーカスが戻ったタイミング(と初回)で、間隔を空けて(最短30分)
 * キャッシュ無視でトップページの HTML を取得し、埋め込まれた Next.js の buildId を
 * 実行中のものと比べる。違っていれば「新しいバージョンがあります」の細いバーを出し、
 * タップで再読み込みする。オフライン時は fetch が失敗するだけで誤検知しない。
 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function UpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const lastCheckRef = useRef(0);
  const readyRef = useRef(false);

  useEffect(() => {
    const currentBuildId = (
      window as unknown as { __NEXT_DATA__?: { buildId?: string } }
    ).__NEXT_DATA__?.buildId;
    if (!currentBuildId || currentBuildId === "development") return;

    async function check() {
      if (readyRef.current) return;
      const now = Date.now();
      if (now - lastCheckRef.current < CHECK_INTERVAL_MS) return;
      lastCheckRef.current = now;
      try {
        const res = await fetch(`/?_v=${now}`, { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/"buildId":"([^"]+)"/);
        if (m && m[1] && m[1] !== currentBuildId) {
          readyRef.current = true;
          setUpdateReady(true);
        }
      } catch {
        // オフライン等。誤って更新バーを出さない
      }
    }

    void check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

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
