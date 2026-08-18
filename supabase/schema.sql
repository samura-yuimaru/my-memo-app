-- ============================================================
-- 完全自動同期アウトライナーメモアプリ: Supabaseスキーマ
-- Supabaseダッシュボード > SQL Editor でこのファイルの内容を実行してください。
-- ============================================================

-- uuid生成に必要な拡張(Supabaseでは通常デフォルトで有効)
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- folders: メモを整理するフォルダ
-- ------------------------------------------------------------
create table if not exists public.folders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '新しいフォルダ',
  -- フォルダの中にフォルダを作れる無限階層。親を削除すると配下のフォルダも連動して消える
  -- (中のメモはnotes.folder_idのon delete set nullにより「フォルダなし」として残る)
  parent_id uuid references public.folders(id) on delete cascade,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_user_id_idx on public.folders (user_id);
create index if not exists folders_parent_id_idx on public.folders (parent_id);

-- ------------------------------------------------------------
-- notes: メモ(ドキュメント)単位のテーブル
-- ------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '無題のメモ',
  folder_id uuid references public.folders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_id_idx on public.notes (user_id);
create index if not exists notes_folder_id_idx on public.notes (folder_id);

-- ------------------------------------------------------------
-- nodes: アウトラインの各行(無限階層)
-- ------------------------------------------------------------
create table if not exists public.nodes (
  id uuid primary key,
  note_id uuid not null references public.notes(id) on delete cascade,
  parent_id uuid references public.nodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position double precision not null default 0,
  content text not null default '',
  node_type text not null default 'normal'
    check (node_type in ('normal', 'why', 'context', 'keyterm', 'memo', 'deeper')),
  collapsed boolean not null default false,
  font_size text not null default 'md'
    check (font_size in ('sm', 'md', 'lg', 'xl')),
  text_color text,
  highlight_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nodes_note_id_idx on public.nodes (note_id);
create index if not exists nodes_parent_id_idx on public.nodes (parent_id);
create index if not exists nodes_user_id_idx on public.nodes (user_id);

-- ------------------------------------------------------------
-- updated_at 自動更新トリガー
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

drop trigger if exists nodes_set_updated_at on public.nodes;
create trigger nodes_set_updated_at
  before update on public.nodes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS(行レベルセキュリティ): 自分のデータのみ読み書き可能
-- ------------------------------------------------------------
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.nodes enable row level security;

drop policy if exists "folders_owner_all" on public.folders;
create policy "folders_owner_all" on public.folders
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notes_owner_all" on public.notes;
create policy "notes_owner_all" on public.notes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "nodes_owner_all" on public.nodes;
create policy "nodes_owner_all" on public.nodes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- セキュリティ強化: anonキーだけでの無制限アクセスを遮断する
-- ------------------------------------------------------------
-- Supabaseはpublicスキーマの新規テーブルに対して、デフォルトでanon/authenticatedの
-- 両ロールへテーブルレベルのSELECT/INSERT/UPDATE/DELETE権限を自動付与する。
-- RLSが有効な限りauth.uid() = user_idで行単位には保護されるが、「anonキーのみ(未認証の
-- 生リクエスト)で無制限アクセスできてしまう」設計ミスを完全に防ぐため、
-- 未認証のanonロールからはテーブル権限そのものを剥奪し、匿名認証済み
-- (=authenticatedロール、is_anonymous=trueのユーザーを含む)のみに権限を絞る。
-- こうすることで、認証セッションなしの生のanon key呼び出しはRLS以前にDB権限の時点で
-- 全操作が拒否されるようになる(多層防御)。
revoke all on public.folders from anon;
revoke all on public.notes from anon;
revoke all on public.nodes from anon;

grant select, insert, update, delete on public.folders to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, update, delete on public.nodes to authenticated;

-- Studioのテーブル作成ウィザード等で作られがちな「全員に許可」系テンプレートポリシーが
-- もし存在していた場合に備えて、念のため代表的な名前を明示的に削除しておく(存在しなければ無害)。
drop policy if exists "Enable read access for all users" on public.folders;
drop policy if exists "Enable insert for authenticated users only" on public.folders;
drop policy if exists "Enable update for users based on user_id" on public.folders;
drop policy if exists "Enable delete for users based on user_id" on public.folders;
drop policy if exists "Enable read access for all users" on public.notes;
drop policy if exists "Enable insert for authenticated users only" on public.notes;
drop policy if exists "Enable update for users based on user_id" on public.notes;
drop policy if exists "Enable delete for users based on user_id" on public.notes;
drop policy if exists "Enable read access for all users" on public.nodes;
drop policy if exists "Enable insert for authenticated users only" on public.nodes;
drop policy if exists "Enable update for users based on user_id" on public.nodes;
drop policy if exists "Enable delete for users based on user_id" on public.nodes;

-- ------------------------------------------------------------
-- Realtime: 変更をクライアントへリアルタイム配信(複数端末の自動同期)
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.folders;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.nodes;

-- ------------------------------------------------------------
-- 補足(SQLではなくダッシュボードで行う設定):
-- Authentication > Providers > Anonymous Sign-ins を有効化してください。
-- これによりログイン画面なしで各ブラウザに匿名ユーザーが自動発行され、
-- 上記RLSポリシーでそのユーザーのデータのみが保護されます。
--
-- このファイルは何度でも安全に再実行できます(create/drop if existsで冪等)。
-- セキュリティ強化セクションを追加した場合は、既存プロジェクトでも
-- SQL Editorで再実行して権限を反映してください。
-- ============================================================
