import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { devWarn } from "@/lib/utils/log";

let cachedClient: SupabaseClient | null | undefined;

/** Supabaseが環境変数で設定されているかどうか */
export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Supabaseクライアントを取得する。
 * URL/ANON_KEYが未設定の場合はnullを返し、呼び出し側はローカル専用モードとして扱う。
 *
 * セキュリティ上の注意:
 * - ここで使うのは公開を前提とした anon key のみ(サービスロールキー等の秘匿情報は
 *   クライアントコードに一切含めない)。実際のデータ保護は各テーブルのRLSポリシー
 *   (auth.uid() = user_id)で行う。
 * - 環境変数の値そのもの(URL・キー)は、エラー時も含めて絶対にconsoleへ出力しない。
 * - detectSessionInUrl は無効化している(このアプリはOAuthリダイレクトを使わず匿名認証のみのため、
 *   URLからセッション情報を解析する経路自体を塞いで攻撃面を減らす)。
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    cachedClient = null;
    return cachedClient;
  }

  // URLの形式を簡易検証する(不正な値でcreateClientが例外を投げるのを避けるため)。
  // 値そのものはログに出さない。
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      devWarn("[supabase] NEXT_PUBLIC_SUPABASE_URLはhttps://で始まる必要があります。ローカル専用モードで動作します。");
      cachedClient = null;
      return cachedClient;
    }
  } catch {
    devWarn("[supabase] NEXT_PUBLIC_SUPABASE_URLの形式が正しくありません。ローカル専用モードで動作します。");
    cachedClient = null;
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  } catch {
    devWarn("[supabase] クライアントの初期化に失敗しました。ローカル専用モードで動作します。");
    cachedClient = null;
  }
  return cachedClient;
}
