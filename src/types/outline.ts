// ============================================================
// アプリ全体で使う型定義
// Supabaseの folders / notes / nodes テーブルと1対1で対応する形にしている。
// ============================================================

/** Axios風スマート構造化ブロックの種類(5種類に限定) */
export type SmartBlockType = "why" | "context" | "deeper" | "next" | "memo";

/** ノードの種類(通常 or スマートブロック) */
export type NodeType = "normal" | SmartBlockType;

/** 文字サイズ */
export type FontSize = "sm" | "md" | "lg" | "xl";

/** 同期状態(画面右上のインジケーターに反映) */
export type SyncStatus = "idle" | "saving" | "saved" | "offline" | "error";

/** アウトラインの1行(フラットなデータ形式) */
export interface OutlineNodeData {
  id: string;
  noteId: string;
  parentId: string | null;
  /** 兄弟内での並び順(浮動小数、中点挿入方式) */
  position: number;
  content: string;
  nodeType: NodeType;
  collapsed: boolean;
  /** @deprecated 文字サイズは階層の深さから自動決定するようになったため未使用(過去データ互換のためフィールドのみ残置) */
  fontSize: FontSize;
  /** 文字色。nullは既定色 */
  textColor: string | null;
  /** @deprecated 蛍光ペン機能は廃止したため未使用(過去データ互換のためフィールドのみ残置) */
  highlightColor: string | null;
  createdAt: string;
  updatedAt: string;
}

/** メモを整理するフォルダ(フォルダの中にフォルダを作れる無限階層) */
export interface FolderData {
  id: string;
  name: string;
  /** 親フォルダ。nullは最上位(ルート直下) */
  parentId: string | null;
  /** 同じ階層内での並び順(浮動小数、中点挿入方式) */
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** メモ(ノートブック)単位のデータ */
export interface NoteData {
  id: string;
  title: string;
  /** 所属フォルダ。nullは未分類(フォルダなし) */
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 画面描画用にツリー化したノード(表示専用、保存はしない) */
export interface OutlineTreeNode extends OutlineNodeData {
  children: OutlineTreeNode[];
}
