// ============================================================
// 削除の「取りこぼし」防止ガード(useOutlineStore から切り出し。deleteGuard.test.ts)
// ============================================================
// 削除の本体はサーバー側の論理削除(deleted_at への UPDATE)であり、一度立った
// deleted_at はどの端末・どのタイミングで取得しても一貫して「削除済み」を意味する。
// ただし「ローカルで削除 → deleted_at の UPDATE がサーバーで確定」までのごく短い間だけは、
// リモート/他タブから取り込んだ「まだ deleted_at が付いていない同じ行」を復活させて
// しまう隙がある。そこを塞ぐためだけの、期限を持たない軽量ガード。
// 削除開始時に markDeleting で登録し、削除同期の完了(成功=deleted_at 確定、または
// 失敗して再送キューへ登録)時に unmarkDeleting で必ず外す。起動時は未送信の削除キュー
// (pendingDeletes)から markDeleting で復元する。

import type { SyncTable } from "@/lib/db/indexeddb";

const deletingIds = new Map<SyncTable, Set<string>>();

/** テスト用: 全ガードをクリアする */
export function resetDeleteGuard(): void {
  deletingIds.clear();
}

/** 削除リクエストの送信を開始した id を記録する(通信の完了を待たず同期的に呼ぶ) */
export function markDeleting(table: SyncTable, ids: Iterable<string>): void {
  let set = deletingIds.get(table);
  if (!set) {
    set = new Set();
    deletingIds.set(table, set);
  }
  for (const id of ids) set.add(id);
}

/** 削除同期が完了(成功/再送キュー登録)した id を外す */
export function unmarkDeleting(table: SyncTable, ids: Iterable<string>): void {
  const set = deletingIds.get(table);
  if (!set) return;
  for (const id of ids) set.delete(id);
}

/** その id が、いま削除リクエスト送信中かどうか */
export function isDeleting(table: SyncTable, id: string): boolean {
  return deletingIds.get(table)?.has(id) ?? false;
}

/** リモート/他タブから取得した行のうち、いま削除リクエストが送信中のものを除外する */
export function excludeDeleting<T extends { id: string }>(table: SyncTable, rows: T[]): T[] {
  const set = deletingIds.get(table);
  if (!set || set.size === 0) return rows;
  return rows.filter((r) => !set.has(r.id));
}
