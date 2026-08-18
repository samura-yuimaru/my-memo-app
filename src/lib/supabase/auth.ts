import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./client";

/**
 * 匿名セッションを確保する。ログイン画面なしで書き始められるようにするため、
 * 既存セッションが無ければ自動的に匿名サインインを行う。
 * (Supabaseダッシュボードで Anonymous Sign-ins を有効化しておく必要がある)
 */
export async function ensureAnonymousSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: sessionData } = await client.auth.getSession();
  if (sessionData.session) return sessionData.session;

  const { data, error } = await client.auth.signInAnonymously();
  if (error) {
    console.error("[supabase] 匿名サインインに失敗しました:", error.message);
    return null;
  }
  return data.session;
}

export async function getCurrentUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}
