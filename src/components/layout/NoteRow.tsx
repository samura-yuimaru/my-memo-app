"use client";

import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";
import { actionIconClass, NO_IOS_CALLOUT, SELECTED_BG_CLASS, SELECTED_TEXT_CLASS } from "@/lib/uiClasses";
import { useRowDrag } from "@/lib/utils/useRowDrag";
import { useSidebarDnd } from "./SidebarDndContext";
import type { NoteData } from "@/types/outline";

interface NoteRowProps {
  note: NoteData;
  active: boolean;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
  /**
   * 親フォルダ(のいずれかの祖先)が現在ドロップ対象としてハイライトされているか。
   * ドロップ対象の水色ハイライトはフォルダの中身全体に及ぶため、その上に乗る
   * メモの文字色もFolderNodeと同じSELECTED_TEXT_CLASSに揃える(ダークモードで
   * ink-700の明るい文字が水色背景に埋もれて読めなくなるのを防ぐ)。
   */
  ancestorHighlighted?: boolean;
}

/**
 * サイドバーのメモ1件分の行。行のどこを押してもドラッグを開始できる(FolderNodeと共通の
 * useRowDragフック)。長押しして指を動かさずに離すと、その場でメモ名を変更できる
 * (iOSのリンクプレビューは発動しないよう抑止している)。
 */
export function NoteRow({ note, active, onOpen, onDelete, ancestorHighlighted = false }: NoteRowProps) {
  const { draggingItem, startDragNote } = useSidebarDnd();
  const renameNote = useOutlineStore((s) => s.renameNote);
  const isDragging = draggingItem?.type === "note" && draggingItem.id === note.id;

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(note.title);

  function startRenaming() {
    setDraft(note.title);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== note.title) renameNote(note.id, trimmed);
    setRenaming(false);
  }

  // フォルダの行(FolderNode)と全く同じ操作感: 行のどこを押しても、長押し(タッチ)/
  // しきい値超えの移動(マウス)でドラッグを開始できる。動かさずに離すと名前変更を開始する。
  const rowDrag = useRowDrag({
    onStartDrag: () => startDragNote(note.id),
    onLongPressRelease: startRenaming,
  });

  function handleNoteClick(e: React.MouseEvent) {
    e.preventDefault();
    onOpen();
  }

  const highlighted = active || ancestorHighlighted;

  return (
    <li className="group/actions">
      <div
        {...rowDrag}
        className={clsx(
          "flex cursor-grab items-center gap-1 rounded-lg pr-1 active:cursor-grabbing",
          NO_IOS_CALLOUT,
          isDragging && "touch-none opacity-40",
          highlighted ? SELECTED_BG_CLASS : "hover:bg-ink-100"
        )}
      >
        {renaming ? (
          <input
            autoFocus
            data-no-drag="true"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
              if (e.key === "Escape") {
                setDraft(note.title);
                setRenaming(false);
              }
            }}
            className="ml-1 min-w-0 flex-1 rounded border border-accent-300 bg-surface px-1.5 py-1 text-base text-ink-800 outline-none"
          />
        ) : (
          <a
            href={`/notes/${note.id}`}
            onClick={handleNoteClick}
            onContextMenu={(e) => e.preventDefault()}
            // <a>は既定でブラウザのネイティブドラッグ(リンクのつまみ出し)が有効なため、
            // 何も指定しないとマウスでの独自ドラッグ検出(useRowDragのしきい値判定)と
            // 競合してうまく発火しないことがある。ここで明示的に無効化しておく。
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className={clsx(
              "flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2.5 pl-2 pr-1 text-base",
              highlighted ? SELECTED_TEXT_CLASS : "text-ink-700"
            )}
          >
            <FileText size={16} className="shrink-0 opacity-70" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{note.title || "無題のメモ"}</span>
          </a>
        )}

        <IconButton
          label="このメモを削除"
          size="sm"
          data-no-drag="true"
          onClick={onDelete}
          className={clsx(
            "shrink-0 hover:!bg-rose-100 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400",
            highlighted && SELECTED_TEXT_CLASS,
            actionIconClass(highlighted)
          )}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
    </li>
  );
}
