"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, FolderPlus } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { BrandHeader } from "./BrandHeader";
import { FolderNode } from "./FolderNode";
import { NoteRow } from "./NoteRow";
import { SidebarDndContext, type SidebarDragItem } from "./SidebarDndContext";

interface SidebarProps {
  /** モバイルでリンクを踏んだ後にメニューを閉じるためのコールバック */
  onNavigate?: () => void;
}

/**
 * 左側サイドバー: 新規メモ・新規フォルダ・フォルダ別のメモ一覧。
 * メモ/フォルダをドラッグして「フォルダなし ⇔ 任意のフォルダ(サブフォルダ含む)」へ
 * 自由に移動できる。ドロップ判定はフォルダの見出し行だけでなく、そのフォルダの
 * 中身全体(サブフォルダ・メモ一覧)を含むブロック全体に対して行う。
 */
export function Sidebar({ onNavigate }: SidebarProps) {
  const router = useRouter();
  const notesList = useOutlineStore((s) => s.notesList);
  const folders = useOutlineStore((s) => s.folders);
  const currentNoteId = useOutlineStore((s) => s.currentNoteId);
  const createNote = useOutlineStore((s) => s.createNote);
  const createFolder = useOutlineStore((s) => s.createFolder);
  const deleteNote = useOutlineStore((s) => s.deleteNote);
  const moveNoteToFolder = useOutlineStore((s) => s.moveNoteToFolder);
  const moveFolderTo = useOutlineStore((s) => s.moveFolderTo);

  const [draggingItem, setDraggingItem] = useState<SidebarDragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  async function handleNewNote(folderId: string | null) {
    const id = await createNote({ folderId });
    router.push(`/notes/${id}`);
    onNavigate?.();
  }

  function openNote(id: string) {
    router.push(`/notes/${id}`);
    onNavigate?.();
  }

  async function handleDeleteNote(e: React.MouseEvent, noteId: string, title: string) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(`「${title || "無題のメモ"}」を削除します。よろしいですか?`);
    if (!ok) return;
    await deleteNote(noteId);
    if (currentNoteId === noteId) router.push("/");
  }

  // 移動先としてfolderIdが有効か(ドラッグ中のフォルダ自身/その子孫でないか)を判定する
  const isValidFolderDropTarget = useCallback(
    (folderId: string): boolean => {
      if (!draggingItem || draggingItem.type !== "folder") return true;
      if (folderId === draggingItem.id) return false;
      let current = folders.find((f) => f.id === folderId);
      while (current?.parentId) {
        if (current.parentId === draggingItem.id) return false;
        current = folders.find((f) => f.id === current!.parentId);
      }
      return true;
    },
    [draggingItem, folders]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingItem) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest("[data-folder-drop]") as HTMLElement | null;
      const raw = target?.getAttribute("data-folder-drop") ?? null;
      const next = raw && raw !== "unfiled" && !isValidFolderDropTarget(raw) ? null : raw;
      setDropTarget((prev) => (prev === next ? prev : next));
    },
    [draggingItem, isValidFolderDropTarget]
  );

  const handlePointerUp = useCallback(() => {
    if (draggingItem && dropTarget) {
      const targetFolderId = dropTarget === "unfiled" ? null : dropTarget;
      if (draggingItem.type === "note") {
        moveNoteToFolder(draggingItem.id, targetFolderId);
      } else {
        moveFolderTo(draggingItem.id, targetFolderId);
      }
    }
    setDraggingItem(null);
    setDropTarget(null);
  }, [draggingItem, dropTarget, moveNoteToFolder, moveFolderTo]);

  const rootFolders = folders.filter((f) => f.parentId === null).sort((a, b) => a.position - b.position);
  const unfiledNotes = notesList.filter((n) => (n.folderId ?? null) === null);

  return (
    <SidebarDndContext.Provider
      value={{
        draggingItem,
        dropTarget,
        startDragNote: (id) => setDraggingItem({ type: "note", id }),
        startDragFolder: (id) => setDraggingItem({ type: "folder", id }),
      }}
    >
      <aside
        className="flex h-full w-full flex-col bg-ink-50/60"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <BrandHeader />

        <div className="flex flex-col gap-2 p-3">
          <button
            type="button"
            onClick={() => void createFolder()}
            className="flex items-center justify-center gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
          >
            <FolderPlus size={16} />
            新規フォルダ
          </button>
          <button
            type="button"
            onClick={() => handleNewNote(null)}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-600"
          >
            <FilePlus2 size={16} />
            新規メモ
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {folders.length === 0 && notesList.length === 0 && (
            <p className="px-2 py-4 text-xs text-ink-400">まだメモがありません</p>
          )}

          {rootFolders.map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              depth={0}
              allFolders={folders}
              notesList={notesList}
              currentNoteId={currentNoteId}
              onOpenNote={openNote}
              onDeleteNote={handleDeleteNote}
              onNewNote={(folderId) => void handleNewNote(folderId)}
            />
          ))}

          {/* 未分類(フォルダなし)セクション: ルート領域自体が明確なドロップ対象になる */}
          <div
            data-folder-drop="unfiled"
            className={clsx(
              "mt-1 rounded-lg pb-1",
              dropTarget === "unfiled" && "bg-accent-100 dark:bg-accent-500/15"
            )}
          >
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              フォルダなし
            </div>
            <ul className="flex flex-col gap-0.5 py-0.5 pl-1">
              {unfiledNotes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  active={currentNoteId === note.id}
                  onOpen={() => openNote(note.id)}
                  onDelete={(e) => void handleDeleteNote(e, note.id, note.title)}
                />
              ))}
              {unfiledNotes.length === 0 && (
                <li className="px-2 py-1 text-xs text-ink-300 dark:text-ink-600">
                  メモをここへドラッグ
                </li>
              )}
            </ul>
          </div>
        </div>
      </aside>
    </SidebarDndContext.Provider>
  );
}
