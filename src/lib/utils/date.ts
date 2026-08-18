export function nowIso(): string {
  return new Date().toISOString();
}

/** ソート・重複判定用のキー("2026-08-17") */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** デイリーノートのタイトル("2026年8月17日(月)") */
export function formatJapaneseDailyTitle(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日(${
    WEEKDAYS_JA[date.getDay()]
  })`;
}

/** サイドバーの更新時刻表示("3分前" 等) */
export function formatRelativeUpdatedAt(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}
