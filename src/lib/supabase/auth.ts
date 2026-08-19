import type { Session } from "@supabase/supabase-js";
import { devError } from "@/lib/utils/log";
import { getSupabaseClient } from "./client";

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
 * PC⇄iPad(複数端末)間で同じアカウントとしてクラウド同期するため、このアプリは
 * メール+パスワードのSupabase Authを使う(匿名認証は端末ごとに別人として扱われて
 * しまい、複数端末で同じデータを共有できないため廃止した)。
 * ここでは「既に有効なセッションがあるか」だけを確認し、無ければ何もしない
 * (自動で新規ユーザーを作ったりはしない。呼び出し側はセッションが無ければ
 * ログイン画面を表示する)。persistSession: trueによりセッションはブラウザの
 * localStorageに保存され、Refresh Tokenの自動更新(autoRefreshToken: true)と
 * 合わせて、アプリを閉じても長期間(数ヶ月単位、明示的にログアウトするまで)
 * 自動的にログイン状態が維持される。
 */
export async function getExistingSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.log("[Sync] Supabaseクライアントが未初期化のためセッション確認をスキップします");
    return null;
  }

  console.log("[Sync] 既存セッションの確認を開始します");
  try {
    const { data } = await withTimeout(client.auth.getSession(), AUTH_CALL_TIMEOUT_MS, "既存セッションの確認");
    if (data.session) {
      console.log("[Sync] 既存セッションが見つかりました userId=", data.session.user.id);
      return data.session;
    }
    console.log("[Sync] 有効な既存セッションはありませんでした");
    return null;
  } catch (err) {
    devError("[supabase] 既存セッションの確認に失敗しました:", err instanceof Error ? err.message : err);
    console.log("[Sync] 既存セッションの確認に失敗/タイムアウトしました");
    return null;
  }
}

export interface AuthResult {
  session: Session | null;
  /** ユーザー向けの日本語エラーメッセージ(成功時はnull) */
  error: string | null;
}

/** よくあるSupabase Authのエラーメッセージを、日本語の分かりやすい文言へ変換する */
function translateAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) return "メールアドレスまたはパスワードが正しくありません";
  if (lower.includes("user already registered")) return "そのメールアドレスは既に登録されています";
  if (lower.includes("email not confirmed")) return "メールアドレスの確認が完了していません。届いた確認メールのリンクを開いてください";
  if (lower.includes("password should be at least")) return "パスワードは6文字以上で入力してください";
  if (lower.includes("invalid email")) return "メールアドレスの形式が正しくありません";
  if (lower.includes("rate limit")) return "試行回数が多すぎます。しばらく待ってからもう一度お試しください";
  return message;
}

/** メール+パスワードでログインする */
export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const client = getSupabaseClient();
  if (!client) return { session: null, error: "Supabaseが設定されていません" };

  try {
    console.log("[Sync] メール+パスワードでのログインを試行します");
    const { data, error } = await withTimeout(
      client.auth.signInWithPassword({ email, password }),
      AUTH_CALL_TIMEOUT_MS,
      "ログイン"
    );
    if (error) {
      console.log("[Sync] ログインに失敗しました:", error.message);
      return { session: null, error: translateAuthError(error.message) };
    }
    console.log("[Sync] ログインに成功しました userId=", data.session?.user.id);
    return { session: data.session, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ネットワークエラーが発生しました";
    devError("[supabase] ログイン処理で例外が発生しました:", message);
    return { session: null, error: translateAuthError(message) };
  }
}

export interface SignUpResult extends AuthResult {
  /** trueの場合、確認メールの承認待ちでまだセッションが発行されていない
   *  (Supabaseプロジェクトの設定でメール確認が必須になっている場合) */
  needsEmailConfirmation: boolean;
}

/** メール+パスワードで新規アカウントを作成する */
export async function signUpWithEmail(email: string, password: string): Promise<SignUpResult> {
  const client = getSupabaseClient();
  if (!client) return { session: null, error: "Supabaseが設定されていません", needsEmailConfirmation: false };

  try {
    console.log("[Sync] メール+パスワードでの新規登録を試行します");
    const { data, error } = await withTimeout(
      client.auth.signUp({ email, password }),
      AUTH_CALL_TIMEOUT_MS,
      "新規登録"
    );
    if (error) {
      console.log("[Sync] 新規登録に失敗しました:", error.message);
      return { session: null, error: translateAuthError(error.message), needsEmailConfirmation: false };
    }
    if (!data.session) {
      // Supabaseプロジェクトで「メール確認を必須にする」設定が有効な場合、ここに来る
      console.log("[Sync] 新規登録は完了しましたが、メール確認待ちです");
      return { session: null, error: null, needsEmailConfirmation: true };
    }
    console.log("[Sync] 新規登録・ログインに成功しました userId=", data.session.user.id);
    return { session: data.session, error: null, needsEmailConfirmation: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ネットワークエラーが発生しました";
    devError("[supabase] 新規登録処理で例外が発生しました:", message);
    return { session: null, error: translateAuthError(message), needsEmailConfirmation: false };
  }
}

/** ログアウトする(このタブのローカルセッションを破棄する) */
export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  console.log("[Sync] ログアウトします");
  try {
    await withTimeout(client.auth.signOut(), AUTH_CALL_TIMEOUT_MS, "ログアウト");
  } catch (err) {
    devError("[supabase] ログアウト処理に失敗しました:", err instanceof Error ? err.message : err);
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}
