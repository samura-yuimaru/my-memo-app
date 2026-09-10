// ============================================================
// OutLiner: 最小限のオフライン起動対応サービスワーカー
// ============================================================
// 目的は「ネットが無い状態でアプリのアイコンを開いても、真っ白/エラーにならず
// 外枠(JS/CSS/画面の骨組み)だけは表示できるようにする」の一点のみ。
// データの保存・同期(Supabase / IndexedDB)には一切関与しない。
//
// キャッシュ方針は用途ごとに分けて、余計なキャッシュ書き込みを増やさない:
//   - /_next/static/... (ビルドごとに名前が変わる不変ファイル)
//       → キャッシュ優先。あればネットワークを待たずに即返す(再訪問が速くなる)。
//         無いときだけ取得して保存する。
//   - ページ遷移(HTMLドキュメント / RSC取得)
//       → ネットワーク優先・失敗時のみキャッシュ。オンラインなら常に最新、
//         オフラインなら最後に開けたものを返す。
//   - それ以外(画像等)・別オリジン(Supabase等)
//       → 何もしない(素通し)。
//
// デプロイのたびに CACHE_NAME を変えると、activate 時に古いキャッシュが破棄される。

const CACHE_NAME = "outliner-offline-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isPageRequest(request, url) {
  if (request.mode === "navigate") return true;
  // Next.js のクライアント遷移(RSC取得)。?_rsc= 付きのGET、または RSC ヘッダ付き
  if (url.search.includes("_rsc=")) return true;
  if (request.headers.get("RSC") === "1") return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // --- 不変の静的アセット: キャッシュ優先 ---
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy).catch(() => {}));
          }
          return res;
        });
      })
    );
    return;
  }

  // --- ページ遷移: ネットワーク優先・失敗時キャッシュ ---
  if (isPageRequest(request, url)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy).catch(() => {}));
          }
          return res;
        })
        .catch(async () => {
          const exact = await caches.match(request);
          if (exact) return exact;
          const loose = await caches.match(request, { ignoreSearch: true });
          if (loose) return loose;
          return Response.error();
        })
    );
    return;
  }

  // --- それ以外: 素通し(キャッシュしない) ---
});
