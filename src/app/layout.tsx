import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "アウトライナーメモ",
  description: "書いた瞬間に自動保存・自動同期される、無限階層のアウトライナーメモアプリ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="bg-surface text-ink-900 antialiased">
        <ThemeProvider>
          <AppProviders>
            <AppShell>{children}</AppShell>
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
