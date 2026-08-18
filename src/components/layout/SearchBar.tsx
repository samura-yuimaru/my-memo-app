"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import clsx from "clsx";
import { searchAll, type SearchResult } from "@/lib/utils/search";
import { IconButton } from "@/components/ui/IconButton";

/**
 * 全メモ横断のリアルタイム検索。階層構造の視認性を邪魔しないよう、
 * 普段はアイコン1つだけの最小表示にとどめ、クリックしたときだけ入力欄を広げる。
 * 入力するたびに該当するメモ/ノードを抽出し、マッチしたキーワード部分を
 * 黄色い網掛けでハイライトした一覧を表示する。
 */
export function SearchBar() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchAll(query).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node) && !query.trim()) {
        setExpanded(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setQuery("");
        setExpanded(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded, query]);

  function goToResult(result: SearchResult) {
    const target = result.nodeId
      ? `/notes/${result.noteId}?highlight=${result.nodeId}`
      : `/notes/${result.noteId}`;
    router.push(target);
    setExpanded(false);
    setQuery("");
  }

  if (!expanded) {
    return (
      <IconButton label="メモを検索" onClick={() => setExpanded(true)}>
        <Search size={17} />
      </IconButton>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-[16rem]">
      <div className="flex items-center gap-1.5 rounded-lg border border-accent-300 bg-ink-50 px-2 py-1.5 dark:bg-ink-100">
        <Search size={15} className="shrink-0 text-ink-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="すべてのメモを検索…"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400"
        />
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setExpanded(false);
          }}
          aria-label="検索を閉じる"
          className="shrink-0 text-ink-400 hover:text-ink-600"
        >
          <X size={14} />
        </button>
      </div>

      {query.trim().length > 0 && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-[60vh] w-[20rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-ink-200 bg-surface-alt shadow-panel">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-400">「{query}」に一致するメモは見つかりませんでした</p>
          ) : (
            <ul className="flex flex-col divide-y divide-ink-100">
              {results.map((r, i) => (
                <li key={`${r.noteId}-${r.nodeId ?? "title"}-${i}`}>
                  <button
                    type="button"
                    onClick={() => goToResult(r)}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-ink-50 dark:hover:bg-ink-100"
                  >
                    <span className="truncate text-xs font-medium text-ink-500">{r.noteTitle}</span>
                    <span className={clsx("truncate text-sm text-ink-800", !r.nodeId && "font-semibold")}>
                      {r.before}
                      <mark
                        className="rounded-sm px-0.5"
                        style={{ backgroundColor: "var(--pick-yellow)", color: "#1a1d24" }}
                      >
                        {r.match}
                      </mark>
                      {r.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
