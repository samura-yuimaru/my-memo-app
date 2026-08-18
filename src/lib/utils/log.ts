/**
 * 開発時のみコンソールへ出力するエラーログ。
 * Supabaseのエラーメッセージ(例: 「行レベルセキュリティポリシーに違反しました」等)は
 * それ自体が機密情報ではないが、内部のテーブル/ポリシー構成を推測するヒントになり得るため、
 * 本番ビルドのブラウザコンソールには一切出さない(セキュリティ強化の一環)。
 * APIキーやセッショントークンなど本当の機密情報は、このロガーを含めコード内のどこにも
 * console出力していない。
 */
export function devError(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
}
