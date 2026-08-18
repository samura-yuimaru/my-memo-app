"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * ダークモード管理(next-themes)。attribute="class"で<html>に
 * "dark" / "light" クラスを付け、globals.cssのCSS変数を切り替える。
 * defaultTheme="system"によりOSのライト/ダーク設定に自動追従する。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
