"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";

/**
 * トップページ。既存メモがあれば(前回開いていたもの優先で)自動的にそこへ移動し、
 * 「一生下に書き続けられる」体験を、開くたびのゼロから感なく続けさせる。
 * メモが1つもない場合のみ、作成のきっかけを示す。
 */
export default function HomePage() {
  const router = useRouter();
  const initialized = useOutlineStore((s) => s.initialized);
  const notesList = useOutlineStore((s) => s.notesList);
  const createNote = useOutlineStore((s) => s.createNote);

  useEffect(() => {
    if (!initialized || notesList.length === 0) return;
    const lastId = typeof window !== "undefined" ? window.localStorage.getItem("lastOpenedNoteId") : null;
    const target = (lastId && notesList.some((n) => n.id === lastId) && lastId) || notesList[0].id;
    router.replace(`/notes/${target}`);
  }, [initialized, notesList, router]);

  if (!initialized || notesList.length > 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">読み込み中…</div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-xl font-bold text-ink-800">ようこそ</h1>
        <p className="mt-1 text-sm text-ink-500">
          書いた瞬間から自動で保存されます。書き出し作業は必要ありません。
        </p>
      </div>
      <button
        type="button"
        onClick={async () => router.push(`/notes/${await createNote()}`)}
        className="flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-600"
      >
        <FilePlus2 size={16} />
        新規メモを作成
      </button>
    </div>
  );
}
