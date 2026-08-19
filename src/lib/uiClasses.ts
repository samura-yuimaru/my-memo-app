import clsx from "clsx";

/**
 * ゴミ箱・並べ替えハンドル・「…」メニュー・スマート構造化・文字色ボタンなど、
 * 行の「操作アイコン」全般に使うクラス。常には隠しておき、
 *   1) その行が「選択中」(開いている/操作対象になっている) か、
 *   2) キーボード操作でアイコン自体にフォーカスが移った(アクセシビリティのための例外)
 * のときだけ表示する。
 *
 * hoverReveal(既定true)をfalseにすると、マウスカーソルが乗っただけ(:hover)では
 * 表示しなくなる。アウトラインのブロック(OutlineNode)は「クリック/タップして選択
 * (網掛け)した時だけ操作アイコンを出す」仕様のためfalseを渡す。サイドバーのフォルダ/
 * メモ行はマウス利用時に見つけやすいよう、既定どおりホバーでも表示する。
 */
export function actionIconClass(selected: boolean, options?: { hoverReveal?: boolean }): string {
  const hoverReveal = options?.hoverReveal ?? true;
  return clsx(
    selected
      ? "opacity-100"
      : clsx(
          "opacity-0 group-focus-within/actions:opacity-100 focus-visible:opacity-100",
          hoverReveal && "group-hover/actions:opacity-100"
        )
  );
}

/**
 * iOS Safariの「長押しでのリンクプレビュー(Peek)」やテキスト選択コールアウトを止めるためのクラス。
 * 長押しをドラッグ開始/名前変更などの独自ジェスチャーに使う要素(サイドバーのメモ・フォルダ名など)に付ける。
 */
export const NO_IOS_CALLOUT = "select-none [-webkit-touch-callout:none]";

/**
 * 「選択済み(網掛け)」状態の行の背景色。通常のink/accentスケールはライト/ダークで
 * 自動的に色が反転するが、選択ハイライトだけはテーマに関わらず同じ鮮やかな水色に固定し、
 * {@link SELECTED_TEXT_CLASS}(常に濃い文字色)と組み合わせて、どちらのテーマでも
 * 確実に高いコントラストで読めるようにする。
 */
export const SELECTED_BG_CLASS = "bg-[#8ab4ff]";
/** {@link SELECTED_BG_CLASS}の上で使う、常に濃く固定された文字色 */
export const SELECTED_TEXT_CLASS = "text-[#0d0f14]";
/** contentEditableの文字色(インラインstyle)を選択中だけ上書きするための16進値 */
export const SELECTED_TEXT_HEX = "#0d0f14";
