import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "OutLiner(アウトライナー)",
  description: "書いた瞬間に自動保存・自動同期される、無限階層のアウトライナーメモアプリ",
  applicationName: "OutLiner",
  // iPadなどで「ホーム画面に追加」した際、Safariのアドレスバーを隠して
  // ネイティブアプリ風の全画面(standalone)表示にするためのメタタグ群
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "OutLiner",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141519" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="bg-surface text-ink-900 antialiased">
        <ThemeProvider>
          <AppProviders>
            <ErrorBoundary label="アプリ">
              <AppShell>{children}</AppShell>
            </ErrorBoundary>
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
