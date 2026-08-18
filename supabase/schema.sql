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
-- ============================================================
