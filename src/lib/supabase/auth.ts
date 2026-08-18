import type { Session } from "@supabase/supabase-js";
import { devError } from "@/lib/utils/log";
import { getSupabaseClient } from "./client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 匿名セッションを確保する。ログイン画面なしで書き始められるようにするため、
 * 既存セッションが無ければ自動的に匿名サインインを行う。
 * (Supabaseダッシュボードで Anonymous Sign-ins を有効化しておく必要がある)
 *
 * ネットワークの瞬断やSupabase側の一時的な応答遅延で失敗することがあるため、
 * 指数バックオフ付きで数回リトライしてから諦める(起動直後・オンライン復帰直後は
 * 特にこうした一時的な失敗が起きやすいため)。
 */
export async function ensureAnonymousSession(retries = 3): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: sessionData } = await client.auth.getSession();
  if (sessionData.session) return sessionData.session;

  let lastErrorMessage = "不明なエラー";
  for (let attempt = 0; attempt < Math.max(1, retries); attempt++) {
    const { data, error } = await client.auth.signInAnonymously();
    if (!error && data.session) return data.session;
    lastErrorMessage = error?.message ?? lastErrorMessage;
    if (attempt < retries - 1) await sleep(500 * 2 ** attempt); // 500ms → 1000ms → 2000ms…
  }
  devError("[supabase] 匿名サインインに失敗しました:", lastErrorMessage);
  return null;
}

export async function getCurrentUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}
