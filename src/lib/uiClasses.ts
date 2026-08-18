import clsx from "clsx";

/**
 * 行ホバー時にだけ表示するアクションボタン用のクラス。
 * 「hover:hover かつ pointer:fine」(=実質マウス/トラックパッド)の環境でのみ
 * ホバーで表示/非表示を切り替える。タッチ操作(iPad・スマホ)ではホバーそのものが
 * 存在しないため、その場合は常時表示にして「ボタンが押せない」事態を避ける。
 * @deprecated サイドバー/削除ボタン等の操作アイコンには {@link actionIconClass} を使う
 * (iPad実機でアイコンが常時並んで階層が読みにくくなるのを避けるため)。
 * 編集行のインライン装飾ボタン(文字色等)のように、常時押せる必要がある箇所にのみ残す。
 */
export const HOVER_REVEAL =
  "opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/actions:opacity-100 focus-visible:opacity-100";

/**
 * ゴミ箱・並べ替えハンドル・「…」メニューなど、サイドバーや行の「操作アイコン」用のクラス。
 * iPad実機ではポインターが指なので常時表示だと階層構造がアイコンだらけで読みにくくなる。
 * そのため常には隠しておき、
 *   1) その行が「選択中」(開いている/操作対象になっている) か、
 *   2) 「ホバー中」(マウス・トラックパッド・Apple Pencilホバーなど実際にホバー可能な入力)
 * のときだけ表示する。純粋な指タッチには hover 自体が存在しないため、
 * その場合は行を選んでから操作する2段階のフローになる(HOVER_REVEALとは逆の考え方)。
 */
export function actionIconClass(selected: boolean): string {
  return clsx(
    selected
      ? "opacity-100"
      : "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100 focus-visible:opacity-100"
  );
}

/**
 * iOS Safariの「長押しでのリンクプレビュー(Peek)」やテキスト選択コールアウトを止めるためのクラス。
 * 長押しをドラッグ開始/名前変更などの独自ジェスチャーに使う要素(サイドバーのメモ・フォルダ名など)に付ける。
 */
export const NO_IOS_CALLOUT = "select-none [-webkit-touch-callout:none]";
