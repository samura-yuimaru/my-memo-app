"use client";

import { GripVertical, Trash2 } from "lucide-react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { HOVER_REVEAL } from "@/lib/uiClasses";
import { safeSetPointerCapture } from "@/lib/utils/dnd";
import { useSidebarDnd } from "./SidebarDndContext";
import type { NoteData } from "@/types/outline";

interface NoteRowProps {
  note: NoteData;
  active: boolean;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

/** サイドバーのメモ1件分の行。グリップをドラッグしてフォルダ間を自由に移動できる */
export function NoteRow({ note, active, onOpen, onDelete }: NoteRowProps) {
  const { draggingItem, startDragNote } = useSidebarDnd();
  const isDragging = draggingItem?.type === "note" && draggingItem.id === note.id;

  return (
    <li className="group/actions">
      <div
        className={clsx(
          "flex items-center gap-0.5 rounded-lg pr-1",
          isDragging && "opacity-40",
          active ? "bg-accent-100 dark:bg-accent-500/15" : "hover:bg-ink-100 dark:hover:bg-ink-800"
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
            "flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-ink-300 active:cursor-grabbing",
            HOVER_REVEAL
          )}
        >
          <GripVertical size={13} />
        </button>
        <a
          href={`/notes/${note.id}`}
          onClick={(e) => {
            e.preventDefault();
            onOpen();
          }}
          className={clsx(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-1 text-sm",
            active ? "text-accent-800" : "text-ink-700"
          )}
        >
          <span className="min-w-0 flex-1 truncate">{note.title || "無題のメモ"}</span>
        </a>
        <IconButton
          label="このメモを削除"
          size="sm"
          onClick={onDelete}
          className={clsx(
            "shrink-0 hover:!bg-rose-100 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400",
            HOVER_REVEAL
          )}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    </li>
  );
}
