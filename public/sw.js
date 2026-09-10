// ============================================================
// OutLiner: 最小限のオフライン起動対応サービスワーカー
// ============================================================
// 方針はあえて単純にしてある(ミニマル・個人利用前提):
// 事前キャッシュリストは持たず、「オンライン中に実際に開いたページ・ファイルを
// その都度キャッシュしておき、オフライン時はそのキャッシュを返す」だけ
// (ネットワーク優先・失敗時のみキャッシュにフォールバック)。
//
// これにより、Supabaseとの通信(ノート/フォルダの中身そのもの)には一切関与しない
// ―データの保存・同期は既存のIndexedDBベースの仕組みがそのまま担当する。
// ここが担当するのは「ネットが無い状態でアプリのアイコンを開いたときに、
// 真っ白/エラー画面にならずアプリの外枠(JS/CSS/画面の骨組み)だけは
// 表示できるようにする」という一点のみ。
//
// 新しいデプロイのたびにこのファイルの内容(または末尾のバージョン番号)を
// 変えると、activate時に古いキャッシュが破棄され、新しいアセットに
// 入れ替わっていく。

const CACHE_NAME = "outliner-offline-v1";

self.addEventListener("install", () => {
  // 新しいバージョンのSWをできるだけ早く有効化する
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

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 同一オリジンのGETリクエストだけを対象にする。
  // Supabase(別オリジン)へのAPI/Realtime通信には一切関与しない
  // ―関与すると、オフライン時の同期エラー処理(dirty化・再試行キュー)を
  // このSWが横取りしてしまい、かえって挙動が複雑になるため。
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // 成功したレスポンスは複製してキャッシュへ保存しておく
        // (次回オフラインになったときのフォールバック用)
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, copy).catch(() => {
            // opaque response等、キャッシュできない種類のレスポンスは黙って諦める
          });
        });
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: false });
        if (cached) return cached;
        // 完全一致(クエリ文字列込み)が無ければ、クエリ文字列を無視した一致も試す
        // (Next.jsのRSCナビゲーションはビルドごとに変わるクエリ付きURLを使うため)
        const cachedIgnoringSearch = await caches.match(request, { ignoreSearch: true });
        if (cachedIgnoringSearch) return cachedIgnoringSearch;
        return Response.error();
      })
  );
});
