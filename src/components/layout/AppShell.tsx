"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileToolbar } from "./MobileToolbar";
import { KeyboardToolbar } from "./KeyboardToolbar";

const MIN_WIDTH = 200;
const MAX_WIDTH = 440;
const DEFAULT_WIDTH = 272;

/** アプリ全体のレイアウト骨格: サイドバー(開閉・リサイズ可能) + ヘッダー + 本文 + モバイル操作バー */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const resizingRef = useRef(false);

  // 前回の開閉状態・幅を復元する
  useEffect(() => {
    const savedOpen = window.localStorage.getItem("sidebar-open");
    const savedWidth = window.localStorage.getItem("sidebar-width");
    if (savedOpen !== null) setSidebarOpen(savedOpen === "1");
    if (savedWidth !== null) {
      const w = Number(savedWidth);
      if (!Number.isNaN(w)) setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));
    }
  }, []);

  function toggleSidebar() {
    setSidebarOpen((v) => {
      const next = !v;
      window.localStorage.setItem("sidebar-open", next ? "1" : "0");
      return next;
    });
  }

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // キャプチャに失敗しても、ポインター移動の検出自体は続行できる
    }
    resizingRef.current = true;
    document.body.classList.add("select-none", "cursor-col-resize");
  }, []);

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    setSidebarWidth(next);
    window.localStorage.setItem("sidebar-width", String(next));
  }, []);

  const handleResizePointerUp = useCallback(() => {
    resizingRef.current = false;
    document.body.classList.remove("select-none", "cursor-col-resize");
  }, []);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-surface text-ink-800">
      {/* デスクトップ用の常設サイドバー(開閉・リサイズ可能) */}
      {sidebarOpen && (
        <div
          className="relative hidden shrink-0 border-r border-ink-100 md:block"
          style={{ width: sidebarWidth }}
        >
          <Sidebar />
          <div
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="ドラッグして幅を変更"
            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none"
          />
        </div>
      )}

      {sidebarOpen ? (
        <button
          type="button"
          onClick={toggleSidebar}
          title="サイドバーを閉じる"
          aria-label="サイドバーを閉じる"
          className="fixed top-16 z-30 hidden h-6 w-6 items-center justify-center rounded-full border border-ink-200 bg-surface text-ink-400 shadow-sm hover:bg-ink-50 md:flex"
          style={{ left: sidebarWidth - 12 }}
        >
          <ChevronLeft size={13} />
        </button>
      ) : (
        <button
          type="button"
          onClick={toggleSidebar}
          title="サイドバーを開く"
          aria-label="サイドバーを開く"
          className="fixed left-2 top-16 z-30 hidden h-6 w-6 items-center justify-center rounded-full border border-ink-200 bg-surface text-ink-400 shadow-sm hover:bg-ink-50 md:flex"
        >
          <ChevronRight size={13} />
        </button>
      )}

      {/* モバイル/タブレット用のドロワー */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-ink-900/30"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-surface shadow-xl">
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100"
                aria-label="メニューを閉じる"
              >
                <X size={18} />
              </button>
            </div>
            <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto overscroll-contain">{children}</main>
        <MobileToolbar />
        <KeyboardToolbar />
      </div>
    </div>
  );
}
