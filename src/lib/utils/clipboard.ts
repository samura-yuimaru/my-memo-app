// ============================================================
// OSクリップボードへの書き込み共通処理。
// 複数ノードのコピー(Ctrl+C、タッチでの範囲選択)の両方から使う。
// ============================================================

/**
 * OSクリップボードへ書き込む(複数ノードコピー、他アプリへの貼り付け・実際の
 * Ctrl+V/長押しペーストでの階層保持貼り付け用)。旧来のdocument.execCommand("copy")
 * によるダミー要素選択トリックは、documentがフォーカスされていない状況や
 * ブラウザによる制限強化で確実に動くとは言えないため、非同期Clipboard API
 * (navigator.clipboard.write / writeText)を使う。カスタムMIMEタイプ付きの書き込みに
 * 失敗した場合はプレーンテキストのみへ、それも失敗した場合は静かに諦める。
 */
export async function writeToOsClipboard(
  plainText: string,
  treePayload: string,
  mimeType: string
): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          [mimeType]: new Blob([treePayload], { type: mimeType }),
        }),
      ]);
      return;
    }
  } catch {
    // カスタムMIME付きの書き込みが拒否される環境向けに、プレーンテキストのみで再試行する
  }
  try {
    await navigator.clipboard.writeText?.(plainText);
  } catch {
    // OSクリップボードへの書き込みが一切できない環境。アプリ内貼り付けには影響しない
  }
}
