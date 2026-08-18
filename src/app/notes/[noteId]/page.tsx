"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { Outliner } from "@/components/outliner/Outliner";

interface NotePageProps {
  params: { noteId: string };
}

/** 1つのメモをアウトライナーで開く画面 */
export default function NotePage({ params }: NotePageProps) {
  const initialized = useOutlineStore((s) => s.initialized);
  const openNote = useOutlineStore((s) => s.openNote);

  useEffect(() => {
    if (!initialized) return;
    void openNote(params.noteId);
  }, [initialized, params.noteId, openNote]);

  return (
    <div className="mx-auto w-full max-w-3xl px-2 py-4 sm:px-6 sm:py-6">
      <Suspense fallback={null}>
        <HighlightFromSearch />
      </Suspense>
      <Outliner />
    </div>
  );
}

/**
 * 検索結果から「?highlight=ノードid」付きで遷移してきた場合、折りたたまれている
 * 祖先ノードを展開してから該当ノードまでスクロールし、一時的に光らせて位置を知らせる。
 */
function HighlightFromSearch() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const loading = useOutlineStore((s) => s.loading);
  const nodes = useOutlineStore((s) => s.nodes);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!highlightId || loading) return;
    if (handledRef.current === highlightId) return;
    const target = nodes[highlightId];
    if (!target) return;

    // 折りたたまれている祖先があれば展開する(展開はnodesの更新を伴うため、
    // このeffectが再実行されて続きが処理される)
    let current = target.parentId ? nodes[target.parentId] : undefined;
    let expandedAny = false;
    while (current) {
      if (current.collapsed) {
        toggleCollapse(current.id);
        expandedAny = true;
      }
      current = current.parentId ? nodes[current.parentId] : undefined;
    }
    if (expandedAny) return;

    handledRef.current = highlightId;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-node-id="${highlightId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("outline-flash");
        setTimeout(() => el.classList.remove("outline-flash"), 1600);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightId, loading, nodes, toggleCollapse]);

  return null;
}
