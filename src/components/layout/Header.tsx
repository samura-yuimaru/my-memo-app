"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";
import { AutosaveIndicator } from "./AutosaveIndicator";
import { ThemeToggle } from "./ThemeToggle";
import { SearchBar } from "./SearchBar";

interface HeaderProps {
  onMenuClick: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

/**
 * 画面上部のヘッダー: メモタイトル編集 + 検索 + 自動保存インジケーター + テーマ切替。
 * 左右の領域を同じ"1fr"で確保することで、中央の列(タイトル)が実際のコンテンツ幅に
 * 関わらず画面の中央に来るようにしている(左右非対称なナビゲーションでも中央寄せできる定番の手法)。
 */
export function Header({ onMenuClick, sidebarOpen, onToggleSidebar }: HeaderProps) {
  const currentNoteId = useOutlineStore((s) => s.currentNoteId);
  const notesList = useOutlineStore((s) => s.notesList);
  const renameNote = useOutlineStore((s) => s.renameNote);
  const note = notesList.find((n) => n.id === currentNoteId);

  return (
    <header className="sticky top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 border-b border-ink-100 bg-surface/90 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-0.5 justify-self-start">
        <IconButton label="メニューを開く" onClick={onMenuClick} className="md:hidden">
          <Menu size={18} />
        </IconButton>
        {/* サイドバーの折りたたみ(集中モード)。デスクトップのみ表示、Ctrl/Cmd+\でも切替可能 */}
        <IconButton
          label={sidebarOpen ? "サイドバーを折りたたむ(Ctrl/Cmd+\\)" : "サイドバーを開く(Ctrl/Cmd+\\)"}
          onClick={onToggleSidebar}
          className="hidden md:flex"
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </IconButton>
      </div>

      <div className="min-w-0 max-w-[min(60vw,32rem)] justify-self-center">
        {note ? (
          <input
            value={note.title}
            onChange={(e) => renameNote(note.id, e.target.value)}
            placeholder="無題のメモ"
            className="w-full min-w-0 truncate border-0 bg-transparent text-center text-lg font-bold text-ink-800 outline-none placeholder:text-ink-300"
          />
        ) : (
          <span className="text-lg font-bold text-ink-300">
            左のメニューからメモを選択してください
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-self-end gap-0.5">
        <SearchBar />
        <ThemeToggle />
        <AutosaveIndicator />
      </div>
    </header>
  );
}
