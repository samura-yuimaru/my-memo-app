/**
 * 文字サイズは手動設定を廃止し、階層の深さから自動的に決定する。
 * ・第1階層(ルートノード): 「大」+ 太字
 * ・第2階層: 「中」
 * ・第3階層以降: 「小」(標準)
 * スマート構造化ブロックの内部(自身がブロック、またはその子孫)は、
 * 階層の深さに関わらず常に「小」に固定する。
 */
export function getAutoFontSizeClass(depth: number, insideSmartBlock: boolean): string {
  if (insideSmartBlock) return "text-sm";
  if (depth === 0) return "text-lg font-bold";
  if (depth === 1) return "text-base";
  return "text-sm";
}

export interface ColorSwatch {
  /** nullは既定に戻す(文字色=黒) */
  value: string | null;
  label: string;
  /** スウォッチ・実際の適用に使うCSS色(テーマに応じて自動で色が変わるCSS変数) */
  swatch: string;
}

/**
 * 文字色パレット(黒・赤・青の3色のみ)。
 * "黒"はテーマに応じて自動で黒/白相当に切り替わる既定色を表す。
 * どの色もライト/ダーク両テーマで読みやすいよう、globals.cssのCSS変数で
 * テーマごとに実際の色を定義している。
 */
export const TEXT_COLOR_PALETTE: ColorSwatch[] = [
  { value: null, label: "黒", swatch: "var(--pick-ink)" },
  { value: "var(--pick-red)", label: "赤", swatch: "var(--pick-red)" },
  { value: "var(--pick-blue)", label: "青", swatch: "var(--pick-blue)" },
];
