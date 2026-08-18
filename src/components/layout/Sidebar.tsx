"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, FilePlus2, FolderPlus, Square, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore, type SidebarItemKey } from "@/lib/store/useOutlineStore";
import { SELECTED_BG_CLASS, SELECTED_TEXT_CLASS } from "@/lib/uiClasses";
import { BrandHeader } from "./BrandHeader";
import { FolderNode } from "./FolderNode";
import { NoteRow } from "./NoteRow";
import { SidebarDndContext, type SidebarDragItem } from "./SidebarDndContext";
import { SidebarSelectionContext } from "./SidebarSelectionContext";

interface SidebarProps {
  /** モバイルでリンクを踏んだ後にメニューを閉じるためのコールバック */
  onNavigate?: () => void;
}

function itemKeyString(type: SidebarItemKey["type"], id: string): string {
  return `${type}:${id}`;
}

/**
 * 左側サイドバー: 新規メモ・新規フォルダ・フォルダ別のメモ一覧。
 * メモ/フォルダをドラッグして「フォルダなし ⇔ 任意のフォルダ(サブフォルダ含む)」へ
 * 自由に移動できる。ドロップ判定はフォルダの見出し行だけでなく、そのフォルダの
 * 中身全体(サブフォルダ・メモ一覧)を含むブロック全体に対して行う。
 * フォルダ・メモは複数選択にも対応し(Ctrl/Cmd+クリック・Shift+クリック・選択モード)、
 * 選択中はまとめて削除・まとめてドラッグ移動ができる。
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
  const sidebarSelection = useOutlineStore((s) => s.sidebarSelection);
  const toggleSidebarSelection = useOutlineStore((s) => s.toggleSidebarSelection);
  const setSidebarSelection = useOutlineStore((s) => s.setSidebarSelection);
  const clearSidebarSelection = useOutlineStore((s) => s.clearSidebarSelection);
  const deleteSidebarSelection = useOutlineStore((s) => s.deleteSidebarSelection);
  const moveSidebarSelectionToFolder = useOutlineStore((s) => s.moveSidebarSelectionToFolder);

  const [draggingItem, setDraggingItem] = useState<SidebarDragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const rangeAnchorRef = useRef<string | null>(null); // "type:id"

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

  // ------------------------------------------------------------
  // 複数選択: Ctrl/Cmd+クリックで個別トグル、Shift+クリックで直前の操作対象からの
  // 範囲選択(画面表示順=DOM順で判定するため、折りたたまれたフォルダの中は含まれない)。
  // それ以外の素のクリックは、既存の選択があれば解除するだけで、開く/折りたたみ等の
  // 通常の操作はそのまま呼び出し側に行わせる。
  // ------------------------------------------------------------
  const handleItemPress = useCallback(
    (type: SidebarItemKey["type"], id: string, modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
      const key = itemKeyString(type, id);

      if (selectionMode || modifiers.ctrlKey || modifiers.metaKey) {
        toggleSidebarSelection(type, id);
        rangeAnchorRef.current = key;
        return true;
      }

      if (modifiers.shiftKey && rangeAnchorRef.current) {
        const container = containerRef.current;
        if (container) {
          const els = Array.from(container.querySelectorAll<HTMLElement>("[data-sidebar-item]"));
          const keys = els.map((el) => el.getAttribute("data-sidebar-item") ?? "");
          const ai = keys.indexOf(rangeAnchorRef.current);
          const bi = keys.indexOf(key);
          if (ai !== -1 && bi !== -1) {
            const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
            const range: SidebarItemKey[] = keys.slice(lo, hi + 1).map((k) => {
              const sep = k.indexOf(":");
              return { type: k.slice(0, sep) as SidebarItemKey["type"], id: k.slice(sep + 1) };
            });
            setSidebarSelection(range);
            return true;
          }
        }
      }

      if (sidebarSelection.length > 0) {
        clearSidebarSelection();
      }
      return false;
    },
    [selectionMode, sidebarSelection, toggleSidebarSelection, setSidebarSelection, clearSidebarSelection]
  );

  const isSelected = useCallback(
    (type: SidebarItemKey["type"], id: string) =>
      sidebarSelection.some((it) => it.type === type && it.id === id),
    [sidebarSelection]
  );

  // 選択中にDelete/Backspaceでまとめて削除する(テキスト編集中やリネーム中は奪わない)
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (sidebarSelection.length === 0) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || (active as HTMLElement).isContentEditable)) return;
      e.preventDefault();
      const ok = window.confirm(`選択中の${sidebarSelection.length}件を削除します。よろしいですか?`);
      if (!ok) return;
      void deleteSidebarSelection();
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [sidebarSelection, deleteSidebarSelection]);

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
      // ドラッグを開始したアイテムが複数選択の一部だった場合は、選択中の全項目を
      // まとめて移動する(1件だけドラッグした場合は従来どおり単体移動)
      const draggingIsPartOfSelection =
        sidebarSelection.length > 1 &&
        sidebarSelection.some((it) => it.type === draggingItem.type && it.id === draggingItem.id);
      if (draggingIsPartOfSelection) {
        moveSidebarSelectionToFolder(targetFolderId);
      } else if (draggingItem.type === "note") {
        moveNoteToFolder(draggingItem.id, targetFolderId);
      } else {
        moveFolderTo(draggingItem.id, targetFolderId);
      }
    }
    setDraggingItem(null);
    setDropTarget(null);
  }, [draggingItem, dropTarget, sidebarSelection, moveSidebarSelectionToFolder, moveNoteToFolder, moveFolderTo]);

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
      <SidebarSelectionContext.Provider
        value={{ selectionMode, isSelected, hasSelection: sidebarSelection.length > 0, handleItemPress }}
      >
        <aside
          ref={containerRef}
          className="flex h-full w-full flex-col bg-ink-50/60"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="flex items-center justify-between">
            <BrandHeader />
            {/* iPad/スマホ向け: 選択モードのオン/オフ切り替え(オンの間はタップでチェックボックスを
                トグルする2段階の複数選択フローになる) */}
            <button
              type="button"
              onClick={() => {
                setSelectionMode((v) => !v);
                clearSidebarSelection();
              }}
              title={selectionMode ? "選択モードを終了" : "複数選択モード"}
              aria-label={selectionMode ? "選択モードを終了" : "複数選択モード"}
              className={clsx(
                "mr-3 flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium",
                selectionMode ? "bg-accent-500 text-white" : "text-ink-400 hover:bg-ink-100"
              )}
            >
              {selectionMode ? <X size={14} /> : <CheckSquare size={14} />}
              {selectionMode ? "完了" : "選択"}
            </button>
          </div>

          <div className="flex flex-col gap-2 p-3">
            <button
              type="button"
              onClick={() => void createFolder()}
              className="flex items-center justify-center gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2.5 text-base font-medium text-ink-600 hover:bg-ink-50"
            >
              <FolderPlus size={18} />
              新規フォルダ
            </button>
            <button
              type="button"
              onClick={() => handleNewNote(null)}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-3 py-2.5 text-base font-semibold text-white shadow-sm hover:bg-accent-600"
            >
              <FilePlus2 size={18} />
              新規メモ
            </button>
          </div>

          {/* 複数選択中の一括操作バー */}
          {sidebarSelection.length > 0 && (
            <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 dark:border-accent-500/30 dark:bg-accent-500/10">
              <span className="text-sm font-medium text-accent-700 dark:text-accent-300">
                {sidebarSelection.length}件選択中
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void deleteSidebarSelection()}
                  title="選択項目を削除"
                  aria-label="選択項目を削除"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-500/10"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={clearSidebarSelection}
                  title="選択解除"
                  aria-label="選択解除"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {folders.length === 0 && notesList.length === 0 && (
              <p className="px-2 py-4 text-sm text-ink-400">まだメモがありません</p>
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
              className={clsx("mt-1 rounded-lg pb-1", dropTarget === "unfiled" && SELECTED_BG_CLASS)}
            >
              <div
                className={clsx(
                  "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wide",
                  dropTarget === "unfiled" ? SELECTED_TEXT_CLASS : "text-ink-400"
                )}
              >
                フォルダなし
              </div>
              {unfiledNotes.length > 0 && (
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
                </ul>
              )}
            </div>
          </div>
        </aside>
      </SidebarSelectionContext.Provider>
    </SidebarDndContext.Provider>
  );
}
