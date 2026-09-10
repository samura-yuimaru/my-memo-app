// ============================================================
// リモート(Supabase)とローカル(IndexedDB/Zustand)のデータを突き合わせる純粋関数。
// 同期処理の中でも特にバグを生みやすい部分なので、useOutlineStore から切り出して
// 単体テストの対象にしている(merge.test.ts)。
// ============================================================

/**
 * id をキーに local と remote をマージする。同じ id はより新しい updatedAt の方を採用する。
 * local にしか無い行(＝まだリモートへ送っていない新規作成分)はそのまま残す。
 * remote にしか無い行(＝他端末での新規作成分)は取り込む。
 */
export function mergeByUpdatedAt<T extends { id: string; updatedAt: string }>(
  local: T[],
  remote: T[]
): T[] {
  const map = new Map<string, T>();
  local.forEach((item) => map.set(item.id, item));
  remote.forEach((item) => {
    const existing = map.get(item.id);
    if (!existing || existing.updatedAt < item.updatedAt) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
}

/**
 * リモートから取得した生の行を、論理削除済み(deleted_at が設定済み)かどうかで振り分ける。
 * 削除は物理 DELETE ではなく deleted_at への UPDATE で表現しているため、folders/notes 一覧の
 * 再取得・開いているメモの nodes 再取得のいずれも、必ずこれを通してから使う。
 * deleted_at が設定された行はサーバー側で確定した削除記録。
 */
export function splitDeletedRows<R extends { id: string; deleted_at?: string | null }>(
  rows: R[]
): { alive: R[]; deletedIds: string[] } {
  const alive: R[] = [];
  const deletedIds: string[] = [];
  for (const r of rows) {
    if (r.deleted_at) deletedIds.push(r.id);
    else alive.push(r);
  }
  return { alive, deletedIds };
}
