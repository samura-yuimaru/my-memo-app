"use client";

import { useState } from "react";
import { ChevronRight, Folder, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";
import { Popover } from "@/components/ui/Popover";
import { safeSetPointerCapture } from "@/lib/utils/dnd";
import { useLongPress } from "@/lib/utils/useLongPress";
import { actionIconClass, NO_IOS_CALLOUT, SELECTED_BG_CLASS, SELECTED_TEXT_CLASS } from "@/lib/uiClasses";
import { NoteRow } from "./NoteRow";
import { useSidebarDnd } from "./SidebarDndContext";
import type { FolderData, NoteData } from "@/types/outline";

interface FolderNodeProps {
  folder: FolderData;
  depth: number;
  allFolders: FolderData[];
  notesList: NoteData[];
  currentNoteId: string | null;
  onOpenNote: (id: string) => void;
  onDeleteNote: (e: React.MouseEvent, id: string, title: string) => void;
  onNewNote: (folderId: string) => void;
}

const INDENT = 12;

/** フォルダ1件分(見出し + 中のメモ + サブフォルダを再帰的に描画) */
export function FolderNode({
  folder,
  depth,
  allFolders,
  notesList,
  currentNoteId,
  onOpenNote,
  onDeleteNote,
  onNewNote,
}: FolderNodeProps) {
  const renameFolder = useOutlineStore((s) => s.renameFolder);
  const deleteFolder = useOutlineStore((s) => s.deleteFolder);
  const createFolder = useOutlineStore((s) => s.createFolder);
  const { draggingItem, dropTarget, startDragFolder } = useSidebarDnd();

  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const [menuOpen, setMenuOpen] = useState(false);

  const childFolders = allFolders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.position - b.position);
  const notes = notesList.filter((n) => (n.folderId ?? null) === folder.id);
  const isDropTarget = dropTarget === folder.id;
  const isDraggingSelf = draggingItem?.type === "folder" && draggingItem.id === folder.id;
  const isEmpty = childFolders.length === 0 && notes.length === 0;

  function startEditing() {
    setDraft(folder.name);
    setEditing(true);
    setMenuOpen(false);
  }

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== folder.name) renameFolder(folder.id, trimmed);
    setEditing(false);
  }

  async function handleDelete() {
    setMenuOpen(false);
    const ok = window.confirm(
      `「${folder.name}」を削除します。サブフォルダも一緒に削除されますが、中のメモは「フォルダなし」に移動します。よろしいですか?`
    );
    if (!ok) return;
    await deleteFolder(folder.id);
  }

  // フォルダ名の押下は「ドラッグ移動」と「名前変更」がはっきり分かれるようにしている:
  // ・タッチ/ペン: 長押しでドラッグを開始する(短いタップは折りたたみのトグルのまま)
  // ・マウス: 長押し不要で、押した瞬間からすぐにドラッグを開始できる(名前変更は
  //   ダブルクリック/右クリックメニュー/「…」メニューに完全分離しているため、
  //   1クリック=ドラッグ開始としても誤操作にならない)
  // 名前変更モードへの移行はダブルクリック・コンテキストメニュー・「…」メニューからのみ行い、
  // 長押しでは絶対に起動しない(長押し→わずかなブレでドラッグと誤認する、といった
  // 誤作動を避けるため)。
  const longPress = useLongPress({
    onLongPress: ({ pointerId, target }) => {
      safeSetPointerCapture(target, pointerId);
      startDragFolder(folder.id);
    },
  });
  function handleNamePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse") {
      safeSetPointerCapture(e.currentTarget, e.pointerId);
      startDragFolder(folder.id);
      return;
    }
    longPress.onPointerDown(e);
  }

  return (
    <div className={clsx(isDraggingSelf && "opacity-40")}>
      <div
        data-folder-drop={folder.id}
        className={clsx("rounded-lg", isDropTarget && SELECTED_BG_CLASS)}
        style={{ paddingLeft: depth * INDENT }}
      >
        <div
          className="group/actions flex items-center gap-0.5 rounded-lg px-1 py-1"
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
        >
          {isEmpty ? (
            // 中身が何もないフォルダは開閉しても表示が変わらないため、トグル矢印自体を
            // 出さない(誤操作の余地をなくし、サイドバーの視覚的なノイズも減らす)
            <span className="h-6 w-6 shrink-0" aria-hidden="true" />
          ) : (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "展開する" : "折りたたむ"}
              className={clsx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-ink-100",
                isDropTarget ? SELECTED_TEXT_CLASS : "text-ink-400"
              )}
            >
              <ChevronRight size={14} className={clsx("transition-transform", !collapsed && "rotate-90")} />
            </button>
          )}

          {editing ? (
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
                  setDraft(folder.name);
                  setEditing(false);
                }
              }}
              className="min-w-0 flex-1 rounded border border-accent-300 bg-surface px-1.5 py-0.5 text-sm text-ink-800 outline-none"
            />
          ) : (
            <button
              type="button"
              data-drag-handle="true"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={handleNamePointerDown}
              onPointerMove={longPress.onPointerMove}
              onPointerUp={longPress.onPointerUp}
              onPointerCancel={longPress.onPointerCancel}
              onClick={() => setCollapsed((v) => !v)}
              onDoubleClick={(e) => {
                e.preventDefault();
                startEditing();
              }}
              title={folder.name}
              className={clsx(
                "flex min-w-0 flex-1 cursor-grab touch-none items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm font-medium hover:bg-ink-100 active:cursor-grabbing",
                isDropTarget ? SELECTED_TEXT_CLASS : "text-ink-700",
                NO_IOS_CALLOUT
              )}
            >
              <Folder size={14} className="shrink-0 opacity-70" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            </button>
          )}

          {/* フォルダの操作は右クリックのコンテキストメニューと、この「…」に集約する
              (フォルダ名が見切れないよう、常時表示のアイコンは最小限にとどめる) */}
          <div className="relative shrink-0">
            <IconButton
              label="フォルダの操作"
              size="sm"
              onClick={() => setMenuOpen((v) => !v)}
              className={actionIconClass(menuOpen || editing)}
            >
              <MoreHorizontal size={14} />
            </IconButton>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="md:right-0 md:top-full md:mt-1 md:w-48">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewNote(folder.id);
                  }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-600 hover:bg-ink-50"
                >
                  <Plus size={14} /> このフォルダに新規メモ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void createFolder(undefined, folder.id);
                  }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-600 hover:bg-ink-50"
                >
                  <FolderPlus size={14} /> サブフォルダを作成
                </button>
                <button
                  type="button"
                  onClick={startEditing}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-600 hover:bg-ink-50"
                >
                  <Pencil size={14} /> 名前を変更
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                >
                  <Trash2 size={14} /> フォルダを削除
                </button>
              </div>
            </Popover>
          </div>
        </div>

        {!collapsed && (
          <>
            {childFolders.map((child) => (
              <FolderNode
                key={child.id}
                folder={child}
                depth={depth + 1}
                allFolders={allFolders}
                notesList={notesList}
                currentNoteId={currentNoteId}
                onOpenNote={onOpenNote}
                onDeleteNote={onDeleteNote}
                onNewNote={onNewNote}
              />
            ))}
            {/* 空フォルダでドラッグ中でもない場合は<ul>ごと出さない(無駄な余白を作らない)。
                「ここにドロップ」ガイドは常時表示せず、実際に何かをドラッグしている間だけ
                ドロップ可能エリアとして点線枠で示す */}
            {(!isEmpty || draggingItem) && (
              <ul className="flex flex-col gap-0.5 py-0.5" style={{ paddingLeft: (depth + 1) * INDENT }}>
                {notes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    active={currentNoteId === note.id}
                    onOpen={() => onOpenNote(note.id)}
                    onDelete={(e) => onDeleteNote(e, note.id, note.title)}
                  />
                ))}
                {isEmpty && draggingItem && (
                  <li
                    className={clsx(
                      "rounded-lg border-2 border-dashed px-2 py-2 text-center text-xs font-medium",
                      isDropTarget
                        ? "border-[#0d0f14]/40 text-[#0d0f14]"
                        : "border-accent-300 text-accent-500 dark:border-accent-400/50 dark:text-accent-300"
                    )}
                  >
                    ここにドロップ
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
