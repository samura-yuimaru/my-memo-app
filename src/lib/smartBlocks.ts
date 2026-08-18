import type { LucideIcon } from "lucide-react";
import { BookOpen, Globe2, Lightbulb, Rocket, StickyNote } from "lucide-react";
import type { SmartBlockType } from "@/types/outline";

export interface SmartBlockDef {
  type: SmartBlockType;
  /** 日本語ラベル(バッジに表示) */
  label: string;
  /** 元のAxios風表現(英語の添え書き) */
  sublabel: string;
  /** 入力欄が空のときのプレースホルダー */
  placeholder: string;
  icon: LucideIcon;
  /** バッジの配色(Tailwindクラス) */
  badgeClass: string;
  shortcutKey: "1" | "2" | "3" | "4" | "5";
}

/**
 * Axios風「スマート構造化」ブロック定義(日本語UI版、5種類限定)。
 * 挿入すると通常のノードと同じ階層に兄弟として追加され、階層が1段深くならない。
 * (通常のノードと同じくトグル折りたたみ・箇条書き表示にも対応する。
 *  内部にTabで子ノードを作ったり、既存のノードをドラッグ&ドロップで
 *  出し入れすることもできる、ごく普通のノードとして扱う)
 */
export const SMART_BLOCKS: SmartBlockDef[] = [
  {
    type: "why",
    label: "なぜ重要なのか",
    sublabel: "Why it matters",
    placeholder: "結論や理由を1〜2文で",
    icon: Lightbulb,
    badgeClass:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
    shortcutKey: "1",
  },
  {
    type: "context",
    label: "背景 / これまでの流れ",
    sublabel: "The big picture",
    placeholder: "経緯や前提を整理",
    icon: Globe2,
    badgeClass:
      "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
    shortcutKey: "2",
  },
  {
    type: "deeper",
    label: "深掘り",
    sublabel: "Go deeper",
    placeholder: "参考書籍・URL・関連メモ",
    icon: BookOpen,
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    shortcutKey: "3",
  },
  {
    type: "next",
    label: "今後の動き / 活かし方",
    sublabel: "What's next",
    placeholder: "次にすべきこと・活かし方",
    icon: Rocket,
    badgeClass:
      "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
    shortcutKey: "4",
  },
  {
    type: "memo",
    label: "メモ",
    sublabel: "Note",
    placeholder: "補足・気づき・メモ書き",
    icon: StickyNote,
    badgeClass:
      "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
    shortcutKey: "5",
  },
];

/**
 * 過去バージョンで存在したブロック種別("keyterm"/"book"/"date"等)がIndexedDB/Supabaseに
 * 保存されたまま残っているケースの保険。SMART_BLOCKSの内容は変わりうるため、
 * 万一"memo"が見つからない場合でもクラッシュしない完全に静的なフォールバックを用意する。
 */
const SAFE_FALLBACK_BLOCK: SmartBlockDef = {
  type: "memo",
  label: "メモ",
  sublabel: "Note",
  placeholder: "補足・気づき・メモ書き",
  icon: StickyNote,
  badgeClass:
    "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
  shortcutKey: "5",
};

/**
 * typeにはSmartBlockType以外の値(過去バージョンの"keyterm"等、または将来の
 * 未知の値)が実行時に渡ってくる可能性がある(IndexedDB/Supabaseのデータはノーチェックで
 * 読み込むため)。該当する定義が見つからない場合は例外を投げず、「メモ」ブロックとして
 * 安全にフォールバック表示する。
 */
export function getSmartBlockDef(type: string): SmartBlockDef {
  const def = SMART_BLOCKS.find((b) => b.type === type);
  if (def) return def;
  return SMART_BLOCKS.find((b) => b.type === "memo") ?? SAFE_FALLBACK_BLOCK;
}
