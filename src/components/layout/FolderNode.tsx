"use client";

import { useState } from "react";
import { ChevronRight, Folder, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";
import { Popover } from "@/components/ui/Popover";
import { useRowDrag } from "@/lib/utils/useRowDrag";
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
  /**
   * 祖先フォルダ(自分を含む階層のどこか上)が現在ドロップ対象としてハイライトされて
   * いるかどうか。ドロップ対象の水色ハイライトは対象フォルダの中身全体(配下の
   * サブフォルダ・メモも含む)に及ぶため、そこに含まれるすべての行の文字色を
   * SELECTED_TEXT_CLASSに揃えないと、ダークモードでink-700(明るい色)の文字が
   * 水色背景に埋もれて読めなくなる。これを子孫へ伝播させるためのフラグ。
   */
  ancestorHighlighted?: boolean;
}

/** 1階層あたりの字下げ幅。「1段下がった」ことがひと目でわかるよう、ツリーガイド線とあわせて広めに取る */
const INDENT = 20;

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
  ancestorHighlighted = false,
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
  // 自分自身がドロップ対象、または祖先フォルダがドロップ対象のハイライト中(=自分も
  // その水色背景の上に乗っている)なら、フォルダ・メモどちらも同じ文字色にする
  const highlighted = isDropTarget || ancestorHighlighted;
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

  // 行(見出し)のどこを押しても、フォルダ・メモの両方で全く同じ操作感でドラッグを開始できる
  // (NoteRowと共通のuseRowDragフック)。
  // ・タッチ/ペン: 長押しでドラッグを開始する(短いタップは折りたたみのトグルのまま)
  // ・マウス: 一定距離を超えて動いた瞬間にドラッグを開始する。ただのクリック(移動なし)では
  //   ドラッグが一切始まらないため、クリックのたびに誤ってドラッグ状態が組まれてしまうことがない
  // 折りたたみ矢印・「…」メニュー・名前変更中のinputはdata-no-dragを付け、ドラッグの起点から除外する。
  // 名前変更モードへの移行はダブルクリック・コンテキストメニュー・「…」メニューからのみ行う。
  const rowDrag = useRowDrag({
    onStartDrag: () => startDragFolder(folder.id),
  });

  return (
    <div className={clsx(isDraggingSelf && "opacity-40")}>
      <div
        data-folder-drop={folder.id}
        className={clsx("relative rounded-lg", isDropTarget && SELECTED_BG_CLASS)}
        style={{ paddingLeft: depth * INDENT }}
      >
        {depth > 0 && <SidebarIndentGuides depth={depth} />}

        <div
          {...rowDrag}
          className={clsx(
            "group/actions flex cursor-grab items-center gap-1 rounded-lg px-1 py-1.5 active:cursor-grabbing",
            NO_IOS_CALLOUT,
            isDraggingSelf && "touch-none"
          )}
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
              data-no-drag="true"
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
                  setDraft(folder.name);
                  setEditing(false);
                }
              }}
              className="min-w-0 flex-1 rounded border border-accent-300 bg-surface px-1.5 py-0.5 text-base text-ink-800 outline-none"
            />
          ) : (
            <button
              type="button"
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => setCollapsed((v) => !v)}
              onDoubleClick={(e) => {
                e.preventDefault();
                startEditing();
              }}
              title={folder.name}
              className={clsx(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-base font-medium hover:bg-ink-100",
                highlighted ? SELECTED_TEXT_CLASS : "text-ink-700"
              )}
            >
              <Folder size={16} className="shrink-0 opacity-70" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            </button>
          )}

          {/* フォルダの操作は右クリックのコンテキストメニューと、この「…」に集約する
              (フォルダ名が見切れないよう、常時表示のアイコンは最小限にとどめる) */}
          <div className="relative shrink-0" data-no-drag="true">
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
                ancestorHighlighted={highlighted}
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
                    ancestorHighlighted={highlighted}
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
