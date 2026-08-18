"use client";

import { useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";
import { actionIconClass, NO_IOS_CALLOUT, SELECTED_BG_CLASS, SELECTED_TEXT_CLASS } from "@/lib/uiClasses";
import { safeSetPointerCapture } from "@/lib/utils/dnd";
import { useLongPress } from "@/lib/utils/useLongPress";
import { useSidebarDnd } from "./SidebarDndContext";
import type { NoteData } from "@/types/outline";

interface NoteRowProps {
  note: NoteData;
  active: boolean;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

/**
 * サイドバーのメモ1件分の行。左端のグリップに加えて、行全体を長押しすることでも
 * ドラッグを開始できる(iPadで小さいグリップを正確につまむ必要をなくすため)。
 * 長押しして指を動かさずに離すと、その場でメモ名を変更できる(iOSのリンクプレビューは
 * 発動しないよう抑止している)。
 */
export function NoteRow({ note, active, onOpen, onDelete }: NoteRowProps) {
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

  const longPress = useLongPress({
    onLongPress: ({ pointerId, target }) => {
      safeSetPointerCapture(target, pointerId);
      startDragNote(note.id);
    },
    onLongPressRelease: startRenaming,
  });

  return (
    <li className="group/actions">
      <div
        className={clsx(
          "flex items-center gap-0.5 rounded-lg pr-1",
          isDragging && "opacity-40",
          active ? SELECTED_BG_CLASS : "hover:bg-ink-100"
        )}
      >
        <button
          type="button"
          data-drag-handle="true"
          onPointerDown={(e) => {
            safeSetPointerCapture(e.currentTarget, e.pointerId);
            startDragNote(note.id);
          }}
          title="ドラッグしてフォルダへ移動"
          className={clsx(
            "flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing",
            active ? SELECTED_TEXT_CLASS : "text-ink-300",
            actionIconClass(active)
          )}
        >
          <GripVertical size={13} />
        </button>

        {renaming ? (
          <input
            autoFocus
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
            className="min-w-0 flex-1 rounded border border-accent-300 bg-surface px-1.5 py-1 text-sm text-ink-800 outline-none"
          />
        ) : (
          <a
            href={`/notes/${note.id}`}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
            onContextMenu={(e) => e.preventDefault()}
            {...longPress}
            className={clsx(
              "flex min-w-0 flex-1 touch-none items-center gap-2 rounded-lg py-2 pr-1 text-sm",
              NO_IOS_CALLOUT,
              active ? SELECTED_TEXT_CLASS : "text-ink-700"
            )}
          >
            <span className="min-w-0 flex-1 truncate">{note.title || "無題のメモ"}</span>
          </a>
        )}

        <IconButton
          label="このメモを削除"
          size="sm"
          onClick={onDelete}
          className={clsx(
            "shrink-0 hover:!bg-rose-100 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400",
            active && SELECTED_TEXT_CLASS,
            actionIconClass(active)
          )}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    </li>
  );
}
