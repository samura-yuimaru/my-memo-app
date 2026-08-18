/**
 * 行ホバー時にだけ表示するアクションボタン用のクラス。
 * 「hover:hover かつ pointer:fine」(=実質マウス/トラックパッド)の環境でのみ
 * ホバーで表示/非表示を切り替える。タッチ操作(iPad・スマホ)ではホバーそのものが
 * 存在しないため、その場合は常時表示にして「ボタンが押せない」事態を避ける。
 */
export const HOVER_REVEAL =
  "opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/actions:opacity-100 focus-visible:opacity-100";
