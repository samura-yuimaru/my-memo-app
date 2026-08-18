import type { Session } from "@supabase/supabase-js";
import { devError } from "@/lib/utils/log";
import { getSupabaseClient } from "./client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Supabaseへの通信が(ネットワークの都合等で)例外もエラーも返さないままいつまでも
 * 応答しない場合に備えたタイムアウト。これが無いと、fetchが宙に浮いたまま
 * awaitし続けることになり、コンソールには何のエラーも出ないのに画面上の同期状態が
 * 「接続中」のまま永遠に遷移しない、という診断しづらい停滞を招く。
 */
const AUTH_CALL_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log(`[Sync] ${label} が${ms}ms以内に応答しなかったためタイムアウトしました`);
      reject(new Error(`${label}がタイムアウトしました`));
    }, ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * 匿名セッションを確保する。ログイン画面なしで書き始められるようにするため、
 * 既存セッションが無ければ自動的に匿名サインインを行う。
 * (Supabaseダッシュボードで Anonymous Sign-ins を有効化しておく必要がある)
 *
 * ネットワークの瞬断やSupabase側の一時的な応答遅延で失敗することがあるため、
 * 指数バックオフ付きで数回リトライしてから諦める(起動直後・オンライン復帰直後は
 * 特にこうした一時的な失敗が起きやすいため)。各段階をconsole.logで可視化し、
 * 本番ビルドでも(devErrorはdev限定のため)進捗・停滞箇所が追えるようにする。
 */
export async function ensureAnonymousSession(retries = 3): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.log("[Sync] Supabaseクライアントが未初期化のため匿名認証をスキップします");
    return null;
  }

  console.log("[Sync] 既存セッションの確認を開始します");
  try {
    const { data: sessionData } = await withTimeout(
      client.auth.getSession(),
      AUTH_CALL_TIMEOUT_MS,
      "既存セッションの確認"
    );
    if (sessionData.session) {
      console.log("[Sync] 既存セッションが見つかりました userId=", sessionData.session.user.id);
      return sessionData.session;
    }
    console.log("[Sync] 既存セッションはありませんでした。匿名サインインへ進みます");
  } catch (err) {
    devError("[supabase] 既存セッションの確認に失敗しました:", err instanceof Error ? err.message : err);
    console.log("[Sync] 既存セッションの確認に失敗/タイムアウトしました。匿名サインインへ進みます");
  }

  let lastErrorMessage = "不明なエラー";
  for (let attempt = 0; attempt < Math.max(1, retries); attempt++) {
    console.log(`[Sync] 匿名サインインを試行します (${attempt + 1}/${retries})`);
    try {
      const { data, error } = await withTimeout(
        client.auth.signInAnonymously(),
        AUTH_CALL_TIMEOUT_MS,
        "匿名サインイン"
      );
      if (!error && data.session) {
        console.log("[Sync] 匿名サインインに成功しました userId=", data.session.user.id);
        return data.session;
      }
      lastErrorMessage = error?.message ?? lastErrorMessage;
      console.log(`[Sync] 匿名サインイン試行${attempt + 1}が失敗しました:`, lastErrorMessage);
    } catch (err) {
      // 完全なネットワーク遮断等でfetch自体が例外を投げた場合も、通常のAPIエラーと
      // 同じリトライ経路に載せる(クラッシュさせず、次の試行へ進む)
      lastErrorMessage = err instanceof Error ? err.message : "ネットワークエラー";
      console.log(`[Sync] 匿名サインイン試行${attempt + 1}で例外/タイムアウトが発生しました:`, lastErrorMessage);
    }
    if (attempt < retries - 1) await sleep(500 * 2 ** attempt); // 500ms → 1000ms → 2000ms…
  }
  devError("[supabase] 匿名サインインに失敗しました:", lastErrorMessage);
  console.log("[Sync] 匿名サインインが最終的に失敗しました:", lastErrorMessage);
  return null;
}

export async function getCurrentUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}
