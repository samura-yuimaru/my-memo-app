"use client";

import { useRef, useState } from "react";
import { CheckSquare, ChevronRight, Folder, FolderPlus, MoreHorizontal, Pencil, Plus, Square, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";
import { Popover } from "@/components/ui/Popover";
import { safeSetPointerCapture } from "@/lib/utils/dnd";
import { useLongPress } from "@/lib/utils/useLongPress";
import { actionIconClass, NO_IOS_CALLOUT, SELECTED_BG_CLASS, SELECTED_TEXT_CLASS } from "@/lib/uiClasses";
import { NoteRow } from "./NoteRow";
import { useSidebarDnd } from "./SidebarDndContext";
import { useSidebarSelection } from "./SidebarSelectionContext";
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

/** 1階層あたりの字下げ幅。「1段下がった」ことがひと目でわかるよう、ツリーガイド線とあわせて広めに取る */
const INDENT = 20;
/** マウスでこの距離を超えて動いたら、クリックではなくドラッグ開始とみなす */
const MOUSE_DRAG_THRESHOLD = 4;

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
  const { selectionMode, isSelected, handleItemPress } = useSidebarSelection();

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
  const selected = isSelected("folder", folder.id);
  // メモ側(NoteRow)の「選択中/開いている」ハイライトと完全に同じ配色ロジックにする。
  // isDropTargetもドラッグ中のドロップ先案内として同じ配色を流用する。
  const highlighted = selected || isDropTarget;

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

  // フォルダ名の押下は「クリック(選択/折りたたみ)」「ドラッグ移動」「名前変更」の
  // 3つがはっきり分かれるようにしている:
  // ・タッチ/ペン: 長押しでドラッグを開始する(短いタップは折りたたみのトグルのまま)
  // ・マウス: 一定距離(MOUSE_DRAG_THRESHOLD)を超えて動いた瞬間にドラッグを開始する。
  //   ただのクリック(移動なし)ではドラッグが一切始まらないため、クリックのたびに
  //   誤ってドラッグ状態が組まれてしまう(=クリックだけで挙動がおかしくなる)ことがない
  // 名前変更モードへの移行はダブルクリック・コンテキストメニュー・「…」メニューからのみ行い、
  // クリックやドラッグでは絶対に起動しない。
  const longPress = useLongPress({
    onLongPress: ({ pointerId, target }) => {
      safeSetPointerCapture(target, pointerId);
      startDragFolder(folder.id);
    },
  });
  const mouseDragRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  function handleNamePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse") {
      mouseDragRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      return;
    }
    longPress.onPointerDown(e);
  }
  function handleNamePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse") {
      const start = mouseDragRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > MOUSE_DRAG_THRESHOLD) {
        safeSetPointerCapture(e.currentTarget, start.pointerId);
        startDragFolder(folder.id);
        mouseDragRef.current = null;
      }
      return;
    }
    longPress.onPointerMove(e);
  }
  function handleNamePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    mouseDragRef.current = null;
    longPress.onPointerUp(e);
  }
  function handleNamePointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    mouseDragRef.current = null;
    longPress.onPointerCancel(e);
  }

  function handleNameClick(e: React.MouseEvent) {
    const consumed = handleItemPress("folder", folder.id, {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    });
    if (consumed) return;
    setCollapsed((v) => !v);
  }

  return (
    <div className={clsx(isDraggingSelf && "opacity-40")}>
      <div
        data-folder-drop={folder.id}
        className={clsx("relative rounded-lg", isDropTarget && SELECTED_BG_CLASS)}
        style={{ paddingLeft: depth * INDENT }}
      >
        {depth > 0 && <SidebarIndentGuides depth={depth} />}

        <div
          className={clsx(
            "group/actions flex items-center gap-1 rounded-lg px-1 py-1.5",
            selected && !isDropTarget && SELECTED_BG_CLASS
          )}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
        >
          {selectionMode && (
            <button
              type="button"
              onClick={() => handleItemPress("folder", folder.id, { ctrlKey: true, metaKey: false, shiftKey: false })}
              className="flex h-6 w-6 shrink-0 items-center justify-center text-accent-600"
              aria-label={selected ? "選択解除" : "選択"}
            >
              {selected ? <CheckSquare size={17} /> : <Square size={17} className="text-ink-300" />}
            </button>
          )}

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
                highlighted ? SELECTED_TEXT_CLASS : "text-ink-400"
              )}
            >
              <ChevronRight size={16} className={clsx("transition-transform", !collapsed && "rotate-90")} />
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
              className="min-w-0 flex-1 rounded border border-accent-300 bg-surface px-1.5 py-0.5 text-base text-ink-800 outline-none"
            />
          ) : (
            <button
              type="button"
              data-sidebar-item={`folder:${folder.id}`}
              data-drag-handle="true"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={handleNamePointerDown}
              onPointerMove={handleNamePointerMove}
              onPointerUp={handleNamePointerUp}
              onPointerCancel={handleNamePointerCancel}
              onClick={handleNameClick}
              onDoubleClick={(e) => {
                e.preventDefault();
                startEditing();
              }}
              title={folder.name}
              className={clsx(
                "flex min-w-0 flex-1 cursor-grab touch-none items-center gap-1.5 rounded px-1 py-0.5 text-left text-base font-medium hover:bg-ink-100 active:cursor-grabbing",
                highlighted ? SELECTED_TEXT_CLASS : "text-ink-700",
                NO_IOS_CALLOUT
              )}
            >
              <Folder size={16} className="shrink-0 opacity-70" aria-hidden="true" />
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
              className={clsx(highlighted && SELECTED_TEXT_CLASS, actionIconClass(menuOpen || editing || highlighted))}
            >
              <MoreHorizontal size={16} />
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
            {/* 空フォルダは中身の<ul>ごと出さない(無駄な余白を作らない)。ドロップ可能かどうかは
                青いハイライト(isDropTarget)だけで示し、案内テキストは表示しない */}
            {!isEmpty && (
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
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** サイドバーのツリー階層を示す縦のガイド線(アウトライン本体のIndentGuidesと同じ考え方) */
function SidebarIndentGuides({ depth }: { depth: number }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0" aria-hidden="true">
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={i}
          className="absolute top-0 h-full w-px bg-ink-200"
          style={{ left: i * INDENT + INDENT / 2 }}
        />
      ))}
    </div>
  );
}
