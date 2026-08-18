"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { devError } from "@/lib/utils/log";

interface ErrorBoundaryProps {
  /** クラッシュ時のメッセージに添える見出し(例: "サイドバー"、"アウトライン") */
  label: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 主要な描画領域(サイドバー・アウトライン本体)を囲むエラー境界。
 * IndexedDB/Supabaseから読み込んだデータが壊れていたり、想定外の形だったりして
 * 描画中に例外が起きても、アプリ全体が白画面クラッシュしないようにするための最終防御線。
 * (データのサニタイズ自体は取り込み側でも行っているが、ここはそれでも防ぎきれなかった
 *  場合の受け皿)。
 * React Error Boundaryはクラスコンポーネントでしか実装できない(フック版は存在しない)。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    devError(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle size={28} className="text-rose-500" />
          <div>
            <p className="text-sm font-semibold text-ink-700">
              {this.props.label}の表示中に問題が発生しました
            </p>
            <p className="mt-1 text-xs text-ink-400">
              データ自体は端末に保存されています。もう一度お試しください。
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600"
          >
            再表示する
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
