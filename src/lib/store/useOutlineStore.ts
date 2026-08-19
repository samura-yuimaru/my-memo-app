// ============================================================
// アプリの中心的な状態管理(Zustand)
// ・現在開いているメモのノード群をフラットなmapで保持
// ・すべての変更操作はここに集約し、実行後に
//   1) 画面即時反映(set) 2) IndexedDBへ即時保存 3) Supabaseへ非同期同期
//   を必ずこの順で行う。
// ============================================================
import { create } from "zustand";
import type {
  FolderData,
  FontSize,
  NoteData,
  OutlineNodeData,
  SmartBlockType,
  SyncStatus,
} from "@/types/outline";
import { generateId } from "@/lib/utils/id";
import { nowIso } from "@/lib/utils/date";
import { devError } from "@/lib/utils/log";
import { escapeHtml, htmlToPlainText, sanitizeHtml, splitHtmlAtOffset } from "@/lib/utils/richText";
import {
  buildTree,
  flattenVisible,
  getNextSibling,
  getPrevSibling,
  getSiblings,
  isSelfOrDescendant,
  midpointPosition,
  sequentialPositions,
} from "@/lib/utils/tree";
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import {
  folderFromRow,
  folderToRow,
  nodeFromRow,
  nodeToRow,
  noteFromRow,
  noteToRow,
  type FolderRow as FolderRowType,
  type NodeRow,
  type NoteRow as NoteRowType,
} from "@/lib/supabase/mappers";
import {
  dbAddPendingDelete,
  dbClearDirty,
  dbClearPendingDelete,
  dbDeleteFolder as dbDeleteFolderLocal,
  dbDeleteNode,
  dbDeleteNodes,
  dbGetAllDirty,
  dbGetAllFolders,
  dbGetAllNodes,
  dbGetAllNotes,
  dbGetMeta,
  dbGetNode,
  dbGetNodesByNote,
  dbGetPendingDeletes,
  dbMarkDirty,
  dbPutFolder,
  dbPutNode,
  dbPutNodes,
  dbPutNote,
  dbSetMeta,
  dbDeleteNote as dbDeleteNoteLocal,
  type SyncTable,
} from "@/lib/db/indexeddb";

/** メモの既定タイトル。1行目からのタイトル自動抽出は、この値のときだけ発動する */
const DEFAULT_NOTE_TITLE = "無題のメモ";

/**
 * アプリ内コピー&ペーストでツリー構造(親子関係)を保持するためのクリップボードMIMEタイプ。
 * 標準の"text/plain"と一緒にこの形式も書き込んでおき、アプリ内へ貼り付けるときだけ
 * こちらを優先して読み取る(他アプリへのペーストは従来どおりプレーンテキストになる)。
 */
export const OUTLINER_CLIPBOARD_MIME = "application/x-outliner-nodes";

interface ClipboardNodeItem {
  id: string;
  /** 選択範囲内の別ノードを指す場合のみ意味を持つ(範囲外を指していた場合はnull=選択の根っこ) */
  parentId: string | null;
  content: string;
  nodeType: string;
  textColor: string | null;
}

interface OutlinerClipboardData {
  outlinerClipboard: 1;
  items: ClipboardNodeItem[];
}

/** JSON書き出し/読み込み(データ保護モーダル)で使うスナップショットの形 */
export interface OutlineSnapshot {
  exportedAt: string;
  folders: FolderData[];
  notes: NoteData[];
  nodes: OutlineNodeData[];
}

export interface FocusRequest {
  id: string;
  /** "start"=先頭 / "end"=末尾 / 数値=文字位置 */
  caret: "start" | "end" | number;
}

interface OutlineState {
  initialized: boolean;
  userId: string | null;
  isOnline: boolean;
  supabaseReady: boolean;
  syncStatus: SyncStatus;
  /** 直近でSupabaseへの同期に成功した日時(ISO)。データ保護ステータスのモーダルに表示する */
  lastSyncedAt: string | null;
  /** Supabaseへの(再)接続処理が進行中かどうか。手動再接続ボタンの二重押下防止・スピナー表示に使う */
  reconnecting: boolean;
  /** Supabaseへまだ送信できていないローカルの変更・削除の件数(IndexedDBのdirty/pendingDeletesの合計) */
  pendingCount: number;

  folders: FolderData[];
  notesList: NoteData[];
  currentNoteId: string | null;
  nodes: Record<string, OutlineNodeData>;
  loading: boolean;

  activeNodeId: string | null;
  focusRequest: FocusRequest | null;
  /** Notion風「2段階Ctrl+A」でのメモ全体選択、およびマウスドラッグでの範囲選択の両方を表す(空配列=通常状態) */
  selectedNodeIds: string[];

  /** Undo/Redo履歴(開いているメモのnodesスナップショットのスタック) */
  undoStack: Record<string, OutlineNodeData>[];
  redoStack: Record<string, OutlineNodeData>[];
  /** Undo/Redoが起きるたびに増分するカウンタ。フォーカス中のノードでもDOMを強制再同期するために使う */
  historyVersion: number;

  init: () => Promise<void>;
  loadNotesList: () => Promise<void>;
  loadFolders: () => Promise<void>;
  openNote: (noteId: string) => Promise<void>;
  createNote: (opts?: { title?: string; folderId?: string | null }) => Promise<string>;
  renameNote: (noteId: string, title: string) => void;
  deleteNote: (noteId: string) => Promise<void>;
  moveNoteToFolder: (noteId: string, folderId: string | null) => void;

  createFolder: (name?: string, parentId?: string | null) => Promise<string>;
  renameFolder: (folderId: string, name: string) => void;
  moveFolderTo: (folderId: string, newParentId: string | null) => void;
  deleteFolder: (folderId: string) => Promise<void>;

  setActiveNodeId: (id: string | null) => void;
  requestFocus: (req: FocusRequest | null) => void;
  clearFocusRequest: () => void;

  updateNodeContent: (nodeId: string, content: string) => void;
  splitNode: (nodeId: string, splitIndex: number) => void;
  /** 改行を含むテキストの貼り付け: 1行目は現在位置に挿入し、残りは新しい兄弟ノードとして追加する */
  pasteLines: (nodeId: string, caretOffset: number, lines: string[]) => void;
  mergeWithPrevious: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  /** 複数ノードの一括削除(範囲選択したノード群に対して使う) */
  deleteNodesBulk: (nodeIds: string[]) => void;
  indentNode: (nodeId: string, caret?: number) => void;
  outdentNode: (nodeId: string, caret?: number) => void;
  /** 複数ノードの一括インデント(表示順で連続する同じ親の並びごとに処理する) */
  indentNodes: (nodeIds: string[]) => void;
  /** 複数ノードの一括インデント解除 */
  outdentNodes: (nodeIds: string[]) => void;
  moveNodeUp: (nodeId: string) => void;
  moveNodeDown: (nodeId: string) => void;
  moveNodeTo: (nodeId: string, newParentId: string | null, newPosition: number) => void;
  /** 複数ノードのドラッグ&ドロップによる一括移動(相対順序を保ったまま挿入する) */
  moveNodesTo: (
    nodeIds: string[],
    newParentId: string | null,
    prevPosition: number | undefined,
    nextPosition: number | undefined
  ) => void;
  toggleCollapse: (nodeId: string) => void;
  setTextColor: (nodeId: string, color: string | null) => void;
  insertSmartBlock: (nodeId: string, type: SmartBlockType) => string;
  focusFirstOrCreate: () => void;
  focusPrevVisible: (nodeId: string) => void;
  focusNextVisible: (nodeId: string) => void;

  selectAllNodes: () => void;
  /** anchorIdからoverIdまでを、画面表示順でまとめて範囲選択する(マウスドラッグ選択用) */
  selectRangeNodes: (anchorId: string, overId: string) => void;
  clearNodeSelection: () => void;

  /** 選択中ノードをツリー構造(親子関係)を保ったままクリップボード用JSONへ書き出す */
  buildClipboardPayload: (nodeIds: string[]) => string;
  /**
   * buildClipboardPayloadで作ったJSONを、指定ノードの直後(同じ階層)に貼り付ける。
   * 形式が正しくなければ何もせずfalseを返す(呼び出し側はそれ以外の通常ペーストへフォールバックできる)。
   */
  pasteClipboardPayload: (payload: string, afterNodeId: string) => boolean;

  undo: () => void;
  redo: () => void;

  /** データ保護モーダルからのJSON書き出し(端末内の全フォルダ・全メモ・全ノード) */
  exportSnapshot: () => Promise<OutlineSnapshot>;
  /** データ保護モーダルからのJSON読み込み(バックアップの復元・機種変更時の引き継ぎ用) */
  importSnapshot: (data: unknown) => Promise<{ folders: number; notes: number; nodes: number }>;

  /**
   * Supabaseへの手動再接続(データ保護ステータスのモーダルの「再試行」ボタンから呼ぶ)。
   * 匿名サインインをやり直し、成功したら同期キューの強制処理・フォルダ/メモ一覧の再取得・
   * 開いているメモの再購読までまとめて行う。
   */
  reconnectSupabase: () => Promise<boolean>;
  /** 未送信の変更・削除件数(pendingCount)を再計算する。データ保護ステータスの表示更新に使う */
  refreshPendingCount: () => Promise<void>;
}

function makeNode(partial: Partial<OutlineNodeData> & { noteId: string }): OutlineNodeData {
  const now = nowIso();
  return {
    id: partial.id ?? generateId(),
    noteId: partial.noteId,
    parentId: partial.parentId ?? null,
    position: partial.position ?? 0,
    content: partial.content ?? "",
    nodeType: partial.nodeType ?? "normal",
    collapsed: partial.collapsed ?? false,
    fontSize: partial.fontSize ?? "md",
    textColor: partial.textColor ?? null,
    highlightColor: partial.highlightColor ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

function mergeByUpdatedAt<T extends { id: string; updatedAt: string }>(
  local: T[],
  remote: T[]
): T[] {
  const map = new Map<string, T>();
  local.forEach((item) => map.set(item.id, item));
  remote.forEach((item) => {
    const existing = map.get(item.id);
    if (!existing || existing.updatedAt < item.updatedAt) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
}

/**
 * 差分チェック: ローカルのdirtyフラグのうち、リモート側が同じか新しい(=ローカルの
 * 未送信の変更が既にリモートに追いついている、または他端末の変更で追い越されている)
 * ものを取り除く。「本当に未送信の変更が無いレコード」を次回のflushで送らずに済ませ、
 * 通信回数・待ち時間を最小限にするための最適化。
 */
function clearDirtyForRemoteWins<T extends { id: string; updatedAt: string }>(
  table: SyncTable,
  local: T[],
  remote: T[]
): void {
  const localMap = new Map(local.map((item) => [item.id, item]));
  const upToDateIds = remote
    .filter((r) => {
      const l = localMap.get(r.id);
      return !l || l.updatedAt <= r.updatedAt;
    })
    .map((r) => r.id);
  if (upToDateIds.length === 0) return;
  void Promise.all(upToDateIds.map((id) => dbClearDirty(table, id)));
}

export const useOutlineStore = create<OutlineState>()((set, get) => ({
  initialized: false,
  userId: null,
  isOnline: true,
  supabaseReady: false,
  syncStatus: "idle",
  lastSyncedAt: null,
  reconnecting: false,
  pendingCount: 0,

  folders: [],
  notesList: [],
  currentNoteId: null,
  nodes: {},
  loading: false,

  activeNodeId: null,
  focusRequest: null,
  selectedNodeIds: [],

  undoStack: [],
  redoStack: [],
  historyVersion: 0,

  init: async () => {
    if (get().initialized) return;
    console.log("[Sync] 初期化を開始します");
    const supabaseReady = isSupabaseConfigured();
    set({ initialized: true, supabaseReady });
    console.log(
      "[Sync] Supabase設定状態:",
      supabaseReady ? "設定済み(クラウド同期を試みます)" : "未設定(端末のみのローカル専用モード)"
    );

    const savedSyncedAt = await dbGetMeta<string>("lastSyncedAt");
    if (savedSyncedAt) set({ lastSyncedAt: savedSyncedAt });

    if (typeof window !== "undefined") {
      set({ isOnline: navigator.onLine });
      window.addEventListener("online", () => {
        console.log("[Sync] オンラインに復帰しました");
        useOutlineStore.setState({ isOnline: true });
        // オンライン復帰時: まだ認証できていなければ匿名サインインからやり直し、
        // 既に認証済みならそのまま未送信分をまとめて送る
        if (!useOutlineStore.getState().userId) void connectSupabase();
        else void flushPendingSync();
      });
      window.addEventListener("offline", () => {
        console.log("[Sync] オフラインになりました");
        useOutlineStore.setState({ isOnline: false, syncStatus: "offline" });
      });

      // タブが非表示になる(他タブへ切替・画面ロック等)瞬間、デバウンス待ちのタイマーを
      // 待たずに保留中の変更を即座に送信する(書き損じ防止)。逆に、タブが再び前面に
      // 戻ってきた(フォーカス復帰)瞬間には、他端末での変更を取りこぼさないよう
      // リモートとの差分を取得し直し、ついでに未送信キューもフラッシュする。
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          console.log("[Sync] タブが非表示になったため、保留中の変更を即時送信します");
          flushAllPendingSync();
        } else if (document.visibilityState === "visible") {
          console.log("[Sync] タブが復帰したため、最新化します");
          void refreshFromRemote();
        }
      });
      // ページを閉じる/リロードする直前にも、可能な範囲で即座に送信を試みる
      // (visibilitychangeの"hidden"が先に発火するのが通常だが、保険として二重に構える)
      window.addEventListener("beforeunload", () => {
        flushAllPendingSync();
      });
      // iPadのPWA(ホーム画面アプリ)ではvisibilitychangeが発火しないウィンドウ切替も
      // あり得るため、window.onfocusでも同じ最新化を行う(refreshFromRemote内で
      // 多重実行はガードしているため、visibilitychangeと同時に発火しても二重通信しない)。
      window.addEventListener("focus", () => {
        console.log("[Sync] ウィンドウがフォーカスされたため、最新化します");
        void refreshFromRemote();
      });

      // タイムアウトや一時的な通信障害で送信できなかった変更(dirtyのまま残っている分)を、
      // ユーザー操作やタブの表示/非表示の遷移が起きなくても自動的に拾い直すための
      // 定期バックグラウンドリトライ。画面を止めることなく静かに再試行し続ける。
      window.setInterval(() => {
        const s = useOutlineStore.getState();
        if (s.isOnline && s.userId && s.pendingCount > 0) {
          console.log("[Sync] バックグラウンド定期リトライを実行します(未送信", s.pendingCount, "件)");
          void flushPendingSync();
        }
      }, BACKGROUND_RETRY_INTERVAL_MS);
    }

    const client = getSupabaseClient();
    if (client) {
      // セッションが失効(トークンリフレッシュ失敗・サインアウト等)した場合に自動で
      // 再認証を試みる、安全な再接続フロー。SupabaseのSDKがトークン更新も自動で
      // 行うが(autoRefreshToken)、それでも失われた場合の最終防御線としてここで検知する。
      client.auth.onAuthStateChange((event, session) => {
        console.log("[Sync] 認証状態が変化しました:", event);
        if (event === "SIGNED_OUT") {
          teardownSyncChannel();
          useOutlineStore.setState({ userId: null });
          void connectSupabase();
          return;
        }
        if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED") {
          useOutlineStore.setState({ userId: session?.user.id ?? null });
        }
      });
    }

    // 起動時: 匿名サインイン(リトライ付き)→ 成功したら即座に未送信分の同期キューを処理する
    if (client) {
      console.log("[Sync] Supabaseへの接続(匿名認証)を開始します");
      await connectSupabase();
    }

    console.log("[Sync] フォルダ/メモ一覧の読み込みを開始します");
    await Promise.all([get().loadFolders(), get().loadNotesList()]);
    console.log("[Sync] 未送信分の同期キューのフラッシュを開始します");
    await flushPendingSync();
    console.log("[Sync] 初期化が完了しました。syncStatus=", get().syncStatus, "userId=", get().userId);
  },

  loadFolders: async () => {
    const local = await dbGetAllFolders();
    set({ folders: sortFolders(local) });

    const client = getSupabaseClient();
    const userId = get().userId;
    if (!client || !userId) return;

    const { data, error } = await safeCall(() =>
      client.from("folders").select("*").eq("user_id", userId)
    );
    if (error) {
      devError("[sync] フォルダ一覧の取得に失敗しました:", error.message);
      return;
    }
    const remoteFolders = (data ?? []).map(folderFromRow);
    markKnownRemote(
      "folders",
      remoteFolders.map((f) => f.id)
    );
    void clearDirtyForRemoteWins("folders", local, remoteFolders);
    const merged = sortFolders(mergeByUpdatedAt(local, remoteFolders));
    await Promise.all(merged.map((f) => dbPutFolder(f)));
    set({ folders: merged });
  },

  loadNotesList: async () => {
    const local = await dbGetAllNotes();
    set({ notesList: sortNotes(local) });

    const client = getSupabaseClient();
    const userId = get().userId;
    if (!client || !userId) return;

    const { data, error } = await safeCall(() =>
      client.from("notes").select("*").eq("user_id", userId)
    );
    if (error) {
      devError("[sync] メモ一覧の取得に失敗しました:", error.message);
      return;
    }
    const remoteNotes = (data ?? []).map(noteFromRow);
    markKnownRemote(
      "notes",
      remoteNotes.map((n) => n.id)
    );
    void clearDirtyForRemoteWins("notes", local, remoteNotes);
    const merged = sortNotes(mergeByUpdatedAt(local, remoteNotes));
    await Promise.all(merged.map((n) => dbPutNote(n)));
    set({ notesList: merged });
  },

  openNote: async (noteId) => {
    set({
      loading: true,
      currentNoteId: noteId,
      nodes: {},
      activeNodeId: null,
      undoStack: [],
      redoStack: [],
      selectedNodeIds: [],
    });
    lastHistoryGroupKey = null;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("lastOpenedNoteId", noteId);
    }

    const localNodes = await dbGetNodesByNote(noteId);
    if (get().currentNoteId === noteId) {
      set({ nodes: toMap(localNodes), loading: false });
      // 既にコンテンツはあるのにタイトルが「無題のメモ」のまま、という既存データを
      // 開いたタイミングでも遡ってタイトルを補完する
      maybeAutoTitleFromFirstNode(noteId, get().nodes);
    }

    const client = getSupabaseClient();
    const userId = get().userId;
    if (client && userId) {
      const { data, error } = await safeCall(() =>
        client.from("nodes").select("*").eq("note_id", noteId)
      );
      if (!error && data) {
        const remoteNodes = (data as NodeRow[]).map(nodeFromRow);
        markKnownRemote(
          "nodes",
          remoteNodes.map((n) => n.id)
        );
        const localNodesBeforeMerge = Object.values(get().nodes);
        void clearDirtyForRemoteWins("nodes", localNodesBeforeMerge, remoteNodes);
        const merged = mergeByUpdatedAt(localNodesBeforeMerge, remoteNodes);
        await dbPutNodes(merged);
        if (get().currentNoteId === noteId) {
          set({ nodes: toMap(merged) });
          maybeAutoTitleFromFirstNode(noteId, get().nodes);
        }
      } else if (error) {
        devError("[sync] ノードの取得に失敗しました:", error.message);
      }
      // nodesのRealtime購読はfolders/notesと同じ単一チャンネル(subscribeSyncChannel)が
      // ユーザー全体を対象に常時張っているため、メモを開くたびに個別購読し直す必要はない
    }

    if (get().currentNoteId === noteId) {
      get().focusFirstOrCreate();
    }
  },

  createNote: async (opts) => {
    const now = nowIso();
    const note: NoteData = {
      id: generateId(),
      title: opts?.title ?? DEFAULT_NOTE_TITLE,
      folderId: opts?.folderId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const seed = makeNode({ noteId: note.id, position: 0 });

    await dbPutNote(note);
    await dbPutNode(seed);
    set((s) => ({ notesList: sortNotes([note, ...s.notesList]) }));

    void persistNote(note);
    void persistNode(seed);

    return note.id;
  },

  renameNote: (noteId, title) => {
    const note = get().notesList.find((n) => n.id === noteId);
    if (!note) return;
    const updated: NoteData = { ...note, title, updatedAt: nowIso() };
    set((s) => ({
      notesList: sortNotes(s.notesList.map((n) => (n.id === noteId ? updated : n))),
    }));
    void persistNote(updated);
  },

  deleteNote: async (noteId) => {
    const wasCurrent = get().currentNoteId === noteId;
    const nodesOfNote = wasCurrent ? Object.values(get().nodes) : await dbGetNodesByNote(noteId);
    const nodeIds = nodesOfNote.map((n) => n.id);

    set((s) => ({
      notesList: s.notesList.filter((n) => n.id !== noteId),
      ...(wasCurrent ? { currentNoteId: null, nodes: {}, activeNodeId: null } : {}),
    }));

    await persistDeleteNoteFull(noteId, nodeIds);
  },

  moveNoteToFolder: (noteId, folderId) => {
    const note = get().notesList.find((n) => n.id === noteId);
    if (!note) return;
    const updated: NoteData = { ...note, folderId, updatedAt: nowIso() };
    set((s) => ({
      notesList: sortNotes(s.notesList.map((n) => (n.id === noteId ? updated : n))),
    }));
    void persistNote(updated);
  },

  createFolder: async (name, parentId) => {
    const now = nowIso();
    const parent = parentId ?? null;
    const siblings = get().folders.filter((f) => f.parentId === parent);
    const folder: FolderData = {
      id: generateId(),
      name: name ?? "新しいフォルダ",
      parentId: parent,
      position: midpointPosition(siblings[siblings.length - 1]?.position, undefined),
      createdAt: now,
      updatedAt: now,
    };
    await dbPutFolder(folder);
    set((s) => ({ folders: sortFolders([...s.folders, folder]) }));
    void persistFolder(folder);
    return folder.id;
  },

  renameFolder: (folderId, name) => {
    const folder = get().folders.find((f) => f.id === folderId);
    if (!folder) return;
    const updated: FolderData = { ...folder, name, updatedAt: nowIso() };
    set((s) => ({
      folders: sortFolders(s.folders.map((f) => (f.id === folderId ? updated : f))),
    }));
    void persistFolder(updated);
  },

  moveFolderTo: (folderId, newParentId) => {
    const state = get();
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    if (newParentId === folderId) return; // 自分自身の中には入れられない
    if (newParentId && isFolderSelfOrDescendant(state.folders, folderId, newParentId)) return; // 循環防止
    if (folder.parentId === newParentId) return; // 変化なし

    const siblings = state.folders.filter((f) => f.parentId === newParentId && f.id !== folderId);
    const updated: FolderData = {
      ...folder,
      parentId: newParentId,
      position: midpointPosition(siblings[siblings.length - 1]?.position, undefined),
      updatedAt: nowIso(),
    };
    set((s) => ({ folders: sortFolders(s.folders.map((f) => (f.id === folderId ? updated : f))) }));
    void persistFolder(updated);
  },

  deleteFolder: async (folderId) => {
    const allFolders = get().folders;
    const toDelete: string[] = [];
    const collect = (id: string) => {
      toDelete.push(id);
      allFolders.filter((f) => f.parentId === id).forEach((f) => collect(f.id));
    };
    collect(folderId);
    const toDeleteSet = new Set(toDelete);

    // フォルダ(配下のサブフォルダ含む)を消してもメモ自体は残す(未分類に戻すだけ)
    const affectedNotes = get().notesList.filter(
      (n) => n.folderId && toDeleteSet.has(n.folderId)
    );
    set((s) => ({
      folders: s.folders.filter((f) => !toDeleteSet.has(f.id)),
      notesList: s.notesList.map((n) =>
        n.folderId && toDeleteSet.has(n.folderId)
          ? { ...n, folderId: null, updatedAt: nowIso() }
          : n
      ),
    }));
    await Promise.all(
      affectedNotes.map((n) => persistNote({ ...n, folderId: null, updatedAt: nowIso() }))
    );
    await persistDeleteFolderFull(folderId, toDelete);
  },

  setActiveNodeId: (id) =>
    set((s) => ({ activeNodeId: id, selectedNodeIds: s.selectedNodeIds.length > 0 ? [] : s.selectedNodeIds })),
  requestFocus: (req) => set({ focusRequest: req, activeNodeId: req?.id ?? get().activeNodeId }),
  clearFocusRequest: () => set({ focusRequest: null }),

  updateNodeContent: (nodeId, content) => {
    const node = get().nodes[nodeId];
    if (!node) return;
    // 同じノードへの連続した入力(通常のタイピング)は1つのUndoステップにまとめる
    pushHistorySnapshot(`content:${nodeId}`);
    const updated: OutlineNodeData = { ...node, content, updatedAt: nowIso() };
    set((s) => ({
      nodes: { ...s.nodes, [nodeId]: updated },
      selectedNodeIds: s.selectedNodeIds.length > 0 ? [] : s.selectedNodeIds,
    }));
    // 1行目(先頭のルートノード)を編集した場合は、タイトル未設定のメモに限りタイトルへ反映する。
    // 「編集前」の1行目の内容から導かれるタイトルを渡すことで、1文字目の入力直後に
    // 自動追従が止まってしまう(タイトルが1文字で固定される)不具合を防ぐ
    const noteId = get().currentNoteId;
    if (node.parentId === null && noteId) {
      const previousFirstLineTitle = htmlToPlainText(node.content).trim().slice(0, 100) || DEFAULT_NOTE_TITLE;
      maybeAutoTitleFromFirstNode(noteId, get().nodes, previousFirstLineTitle);
    }
    void persistNode(updated);
  },

  splitNode: (nodeId, splitIndex) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node || !state.currentNoteId) return;
    pushHistorySnapshot(null);
    const allNodes = Object.values(state.nodes);

    const [before, after] = splitHtmlAtOffset(node.content, splitIndex);
    const updatedCurrent: OutlineNodeData = { ...node, content: before, updatedAt: nowIso() };

    // 子の有無やトグルの開閉に関わらず、Enterでの分割は常に同じ階層の「次の兄弟」として
    // 挿入する(子を持つ行で改行すると勝手にインデントが下がる、という挙動を避けるため)
    const nextSibling = getNextSibling(allNodes, node);
    const newNode: OutlineNodeData = makeNode({
      noteId: state.currentNoteId,
      parentId: node.parentId,
      position: midpointPosition(node.position, nextSibling?.position),
      content: after,
    });

    set((s) => ({
      nodes: { ...s.nodes, [nodeId]: updatedCurrent, [newNode.id]: newNode },
      focusRequest: { id: newNode.id, caret: "start" },
    }));
    void persistNode(updatedCurrent);
    void persistNode(newNode);
  },

  pasteLines: (nodeId, caretOffset, lines) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node || !state.currentNoteId || lines.length === 0) return;
    pushHistorySnapshot(null);

    const [before, after] = splitHtmlAtOffset(node.content, caretOffset);
    const escapedLines = lines.map(escapeHtml);
    const updatedCurrent: OutlineNodeData = {
      ...node,
      content: before + escapedLines[0],
      updatedAt: nowIso(),
    };

    const allNodes = Object.values(state.nodes);
    const nextSibling = getNextSibling(allNodes, node);
    const newNodes: OutlineNodeData[] = [];
    let prevPosition = node.position;
    for (let i = 1; i < escapedLines.length; i++) {
      const isLast = i === escapedLines.length - 1;
      const pos = midpointPosition(prevPosition, nextSibling?.position);
      const n = makeNode({
        noteId: state.currentNoteId,
        parentId: node.parentId,
        position: pos,
        content: isLast ? escapedLines[i] + after : escapedLines[i],
      });
      newNodes.push(n);
      prevPosition = pos;
    }

    const lastLinePlainLength = lines[lines.length - 1].length;
    const focusTarget: FocusRequest =
      newNodes.length > 0
        ? { id: newNodes[newNodes.length - 1].id, caret: lastLinePlainLength }
        : { id: nodeId, caret: caretOffset + lines[0].length };

    set((s) => {
      const next = { ...s.nodes, [nodeId]: updatedCurrent };
      newNodes.forEach((n) => {
        next[n.id] = n;
      });
      return { nodes: next, focusRequest: focusTarget };
    });
    void persistNode(updatedCurrent);
    newNodes.forEach((n) => void persistNode(n));
  },

  mergeWithPrevious: (nodeId) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node) return;
    const allNodes = Object.values(state.nodes);
    const hasChildren = allNodes.some((n) => n.parentId === node.id);
    if (hasChildren) return;

    const flat = flattenVisible(buildTree(allNodes));
    const idx = flat.findIndex((n) => n.id === nodeId);
    const prev = idx > 0 ? flat[idx - 1] : undefined;
    if (!prev) return;
    pushHistorySnapshot(null);

    const caretPos = htmlToPlainText(prev.content).length;
    const updatedPrev: OutlineNodeData = {
      ...state.nodes[prev.id],
      content: prev.content + node.content,
      updatedAt: nowIso(),
    };

    set((s) => {
      const next = { ...s.nodes };
      delete next[nodeId];
      next[prev.id] = updatedPrev;
      return { nodes: next, focusRequest: { id: prev.id, caret: caretPos } };
    });
    void persistNode(updatedPrev);
    void persistDeleteNodes([nodeId], node.noteId);
  },

  deleteNode: (nodeId) => {
    const state = get();
    if (!state.currentNoteId) return;
    pushHistorySnapshot(null);
    const allNodes = Object.values(state.nodes);

    const toDelete: string[] = [];
    const collect = (id: string) => {
      toDelete.push(id);
      allNodes.filter((n) => n.parentId === id).forEach((c) => collect(c.id));
    };
    collect(nodeId);
    const toDeleteSet = new Set(toDelete);

    const flat = flattenVisible(buildTree(allNodes));
    const idx = flat.findIndex((n) => n.id === nodeId);
    const before = idx > 0 ? flat[idx - 1] : undefined;
    const after = flat.slice(idx + 1).find((n) => !toDeleteSet.has(n.id));
    const focusTarget = before ?? after;

    let seed: OutlineNodeData | null = null;
    set((s) => {
      const next = { ...s.nodes };
      toDelete.forEach((id) => delete next[id]);
      if (Object.keys(next).length === 0) {
        seed = makeNode({ noteId: state.currentNoteId as string, position: 0 });
        next[seed.id] = seed;
      }
      return {
        nodes: next,
        focusRequest: seed
          ? { id: seed.id, caret: "start" }
          : focusTarget
          ? { id: focusTarget.id, caret: "end" }
          : null,
      };
    });

    void persistDeleteNodes(toDelete, state.currentNoteId);
    if (seed) void persistNode(seed);
  },

  deleteNodesBulk: (nodeIds) => {
    const state = get();
    if (!state.currentNoteId || nodeIds.length === 0) return;
    pushHistorySnapshot(null);
    const allNodes = Object.values(state.nodes);

    const toDelete: string[] = [];
    const collect = (id: string) => {
      if (toDelete.includes(id)) return;
      toDelete.push(id);
      allNodes.filter((n) => n.parentId === id).forEach((c) => collect(c.id));
    };
    nodeIds.forEach(collect);

    let seed: OutlineNodeData | null = null;
    set((s) => {
      const next = { ...s.nodes };
      toDelete.forEach((id) => delete next[id]);
      if (Object.keys(next).length === 0) {
        seed = makeNode({ noteId: state.currentNoteId as string, position: 0 });
        next[seed.id] = seed;
      }
      return {
        nodes: next,
        selectedNodeIds: [],
        focusRequest: seed ? { id: seed.id, caret: "start" } : null,
      };
    });

    void persistDeleteNodes(toDelete, state.currentNoteId);
    if (seed) void persistNode(seed);
  },

  indentNode: (nodeId, caret) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node) return;
    const allNodes = Object.values(state.nodes);
    const prevSibling = getPrevSibling(allNodes, node);
    if (!prevSibling) return;
    pushHistorySnapshot(null);

    const futureSiblings = getSiblings(allNodes, prevSibling.id);
    const lastChild = futureSiblings[futureSiblings.length - 1];
    const updated: OutlineNodeData = {
      ...node,
      parentId: prevSibling.id,
      position: midpointPosition(lastChild?.position, undefined),
      updatedAt: nowIso(),
    };

    set((s) => {
      const next = { ...s.nodes, [nodeId]: updated };
      if (prevSibling.collapsed) {
        next[prevSibling.id] = { ...prevSibling, collapsed: false, updatedAt: nowIso() };
      }
      // 親をまたぐ移動はReactにとって「別ツリー位置への再マウント」になり、
      // 何もしないとテキストエリアがフォーカスを失ってしまう。再マウント後に
      // 同じキャレット位置へフォーカスを戻すよう要求しておく。
      return { nodes: next, focusRequest: { id: nodeId, caret: caret ?? "end" } };
    });
    void persistNode(updated);
    if (prevSibling.collapsed) {
      void persistNode({ ...prevSibling, collapsed: false, updatedAt: nowIso() });
    }
  },

  outdentNode: (nodeId, caret) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node || !node.parentId) return;
    const parent = state.nodes[node.parentId];
    if (!parent) return;
    pushHistorySnapshot(null);
    const allNodes = Object.values(state.nodes);
    const parentNextSibling = getNextSibling(allNodes, parent);

    const updated: OutlineNodeData = {
      ...node,
      parentId: parent.parentId,
      position: midpointPosition(parent.position, parentNextSibling?.position),
      updatedAt: nowIso(),
    };
    // indentNodeと同様、親が変わるとDOMが再マウントされフォーカスが失われるため復元要求を出す
    set((s) => ({
      nodes: { ...s.nodes, [nodeId]: updated },
      focusRequest: { id: nodeId, caret: caret ?? "end" },
    }));
    void persistNode(updated);
  },

  indentNodes: (nodeIds) => {
    const state = get();
    if (nodeIds.length === 0) return;
    const allNodes = Object.values(state.nodes);
    const flat = flattenVisible(buildTree(allNodes));
    const selectedSet = new Set(nodeIds);
    // 選択ノードを表示順に並べ、「同じ親を持つ連続した並び」ごとにグループ化して処理する
    const ordered = flat.filter((n) => selectedSet.has(n.id));
    const groups: OutlineNodeData[][] = [];
    for (const n of ordered) {
      const last = groups[groups.length - 1];
      if (last && last[last.length - 1].parentId === n.parentId) last.push(n);
      else groups.push([n]);
    }

    const updates: OutlineNodeData[] = [];
    const collapsedFixes: OutlineNodeData[] = [];
    for (const group of groups) {
      const first = group[0];
      const prevSibling = getPrevSibling(allNodes, first);
      if (!prevSibling || selectedSet.has(prevSibling.id)) continue; // インデントできない(先頭グループ等)
      const futureSiblings = getSiblings(allNodes, prevSibling.id);
      let cursor = futureSiblings[futureSiblings.length - 1]?.position;
      for (const n of group) {
        const pos = midpointPosition(cursor, undefined);
        updates.push({ ...n, parentId: prevSibling.id, position: pos, updatedAt: nowIso() });
        cursor = pos;
      }
      if (prevSibling.collapsed) {
        collapsedFixes.push({ ...prevSibling, collapsed: false, updatedAt: nowIso() });
      }
    }
    if (updates.length === 0) return;
    pushHistorySnapshot(null);
    set((s) => {
      const next = { ...s.nodes };
      updates.forEach((u) => (next[u.id] = u));
      collapsedFixes.forEach((c) => (next[c.id] = c));
      return { nodes: next };
    });
    updates.forEach((u) => void persistNode(u));
    collapsedFixes.forEach((c) => void persistNode(c));
  },

  outdentNodes: (nodeIds) => {
    const state = get();
    if (nodeIds.length === 0) return;
    const allNodes = Object.values(state.nodes);
    const flat = flattenVisible(buildTree(allNodes));
    const selectedSet = new Set(nodeIds);
    const ordered = flat.filter((n) => selectedSet.has(n.id));
    const groups: OutlineNodeData[][] = [];
    for (const n of ordered) {
      const last = groups[groups.length - 1];
      if (last && last[last.length - 1].parentId === n.parentId) last.push(n);
      else groups.push([n]);
    }

    const updates: OutlineNodeData[] = [];
    for (const group of groups) {
      const first = group[0];
      if (!first.parentId) continue; // 既に最上位
      const parent = state.nodes[first.parentId];
      if (!parent) continue;
      const parentNextSibling = getNextSibling(allNodes, parent);
      let cursor: number | undefined = parent.position;
      for (const n of group) {
        const pos = midpointPosition(cursor, parentNextSibling?.position);
        updates.push({ ...n, parentId: parent.parentId, position: pos, updatedAt: nowIso() });
        cursor = pos;
      }
    }
    if (updates.length === 0) return;
    pushHistorySnapshot(null);
    set((s) => {
      const next = { ...s.nodes };
      updates.forEach((u) => (next[u.id] = u));
      return { nodes: next };
    });
    updates.forEach((u) => void persistNode(u));
  },

  moveNodeUp: (nodeId) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node) return;
    const siblings = getSiblings(Object.values(state.nodes), node.parentId);
    const idx = siblings.findIndex((s) => s.id === nodeId);
    if (idx <= 0) return;
    pushHistorySnapshot(null);
    const target = siblings[idx - 1];
    const before = siblings[idx - 2];
    const updated: OutlineNodeData = {
      ...node,
      position: midpointPosition(before?.position, target.position),
      updatedAt: nowIso(),
    };
    set((s) => ({ nodes: { ...s.nodes, [nodeId]: updated } }));
    void persistNode(updated);
  },

  moveNodeDown: (nodeId) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node) return;
    const siblings = getSiblings(Object.values(state.nodes), node.parentId);
    const idx = siblings.findIndex((s) => s.id === nodeId);
    if (idx === -1 || idx >= siblings.length - 1) return;
    pushHistorySnapshot(null);
    const target = siblings[idx + 1];
    const after = siblings[idx + 2];
    const updated: OutlineNodeData = {
      ...node,
      position: midpointPosition(target.position, after?.position),
      updatedAt: nowIso(),
    };
    set((s) => ({ nodes: { ...s.nodes, [nodeId]: updated } }));
    void persistNode(updated);
  },

  moveNodeTo: (nodeId, newParentId, newPosition) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node) return;
    const allNodes = Object.values(state.nodes);
    if (newParentId && isSelfOrDescendant(allNodes, nodeId, newParentId)) return;
    pushHistorySnapshot(null);
    const updated: OutlineNodeData = {
      ...node,
      parentId: newParentId,
      position: newPosition,
      updatedAt: nowIso(),
    };
    set((s) => ({ nodes: { ...s.nodes, [nodeId]: updated } }));
    void persistNode(updated);
  },

  moveNodesTo: (nodeIds, newParentId, prevPosition, nextPosition) => {
    const state = get();
    if (nodeIds.length === 0) return;
    const allNodes = Object.values(state.nodes);
    if (newParentId && nodeIds.some((id) => isSelfOrDescendant(allNodes, id, newParentId))) return;
    const flat = flattenVisible(buildTree(allNodes));
    const selectedSet = new Set(nodeIds);
    const ordered = flat.filter((n) => selectedSet.has(n.id));
    if (ordered.length === 0) return;
    pushHistorySnapshot(null);
    const positions = sequentialPositions(prevPosition, nextPosition, ordered.length);
    const updates = ordered.map((n, i) => ({
      ...n,
      parentId: newParentId,
      position: positions[i],
      updatedAt: nowIso(),
    }));
    set((s) => {
      const next = { ...s.nodes };
      updates.forEach((u) => (next[u.id] = u));
      return { nodes: next };
    });
    updates.forEach((u) => void persistNode(u));
  },

  toggleCollapse: (nodeId) => {
    const node = get().nodes[nodeId];
    if (!node) return;
    const updated: OutlineNodeData = { ...node, collapsed: !node.collapsed, updatedAt: nowIso() };
    set((s) => ({ nodes: { ...s.nodes, [nodeId]: updated } }));
    void persistNode(updated);
  },

  setTextColor: (nodeId, color) => {
    const node = get().nodes[nodeId];
    if (!node) return;
    pushHistorySnapshot(null);
    const updated: OutlineNodeData = { ...node, textColor: color, updatedAt: nowIso() };
    set((s) => ({ nodes: { ...s.nodes, [nodeId]: updated } }));
    void persistNode(updated);
  },

  insertSmartBlock: (nodeId, type) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node || !state.currentNoteId) return "";
    pushHistorySnapshot(null);
    // 子として1段深く差し込むのではなく、同じ階層の「次の兄弟」として挿入する。
    // (通常のノードと全く同じ扱いになるため、トグル折りたたみ・箇条書き表示も
    //  他のノードと同様にそのまま使える)
    const allNodes = Object.values(state.nodes);
    const nextSibling = getNextSibling(allNodes, node);
    const newNode = makeNode({
      noteId: state.currentNoteId,
      parentId: node.parentId,
      position: midpointPosition(node.position, nextSibling?.position),
      nodeType: type,
    });

    set((s) => ({
      nodes: { ...s.nodes, [newNode.id]: newNode },
      focusRequest: { id: newNode.id, caret: "start" },
    }));
    void persistNode(newNode);
    return newNode.id;
  },

  focusFirstOrCreate: () => {
    const state = get();
    if (!state.currentNoteId) return;
    const flat = flattenVisible(buildTree(Object.values(state.nodes)));
    if (flat.length > 0) {
      set({ focusRequest: { id: flat[0].id, caret: "start" } });
    }
  },

  focusPrevVisible: (nodeId) => {
    const flat = flattenVisible(buildTree(Object.values(get().nodes)));
    const idx = flat.findIndex((n) => n.id === nodeId);
    if (idx > 0) {
      set({ focusRequest: { id: flat[idx - 1].id, caret: "end" }, activeNodeId: flat[idx - 1].id });
    }
  },

  focusNextVisible: (nodeId) => {
    const flat = flattenVisible(buildTree(Object.values(get().nodes)));
    const idx = flat.findIndex((n) => n.id === nodeId);
    if (idx !== -1 && idx < flat.length - 1) {
      set({ focusRequest: { id: flat[idx + 1].id, caret: "start" }, activeNodeId: flat[idx + 1].id });
    }
  },

  selectAllNodes: () => {
    const flat = flattenVisible(buildTree(Object.values(get().nodes)));
    set({ selectedNodeIds: flat.map((n) => n.id) });
  },
  selectRangeNodes: (anchorId, overId) => {
    const flat = flattenVisible(buildTree(Object.values(get().nodes)));
    const ai = flat.findIndex((n) => n.id === anchorId);
    const oi = flat.findIndex((n) => n.id === overId);
    if (ai === -1 || oi === -1) return;
    const [lo, hi] = ai <= oi ? [ai, oi] : [oi, ai];
    set({ selectedNodeIds: flat.slice(lo, hi + 1).map((n) => n.id) });
  },
  clearNodeSelection: () => set({ selectedNodeIds: [] }),

  buildClipboardPayload: (nodeIds) => {
    const nodes = get().nodes;
    const idSet = new Set(nodeIds);
    const items: ClipboardNodeItem[] = nodeIds
      .map((id) => nodes[id])
      .filter((n): n is OutlineNodeData => !!n)
      .map((n) => ({
        id: n.id,
        // 選択範囲外を指す親は「選択の根っこ」として扱う(貼り付け先の階層にそのまま乗せる)
        parentId: n.parentId && idSet.has(n.parentId) ? n.parentId : null,
        content: n.content,
        nodeType: n.nodeType,
        textColor: n.textColor,
      }));
    return JSON.stringify({ outlinerClipboard: 1, items } satisfies OutlinerClipboardData);
  },

  pasteClipboardPayload: (payload, afterNodeId) => {
    const state = get();
    if (!state.currentNoteId) return false;

    let parsed: OutlinerClipboardData | null = null;
    try {
      const data = JSON.parse(payload);
      if (data && data.outlinerClipboard === 1 && Array.isArray(data.items) && data.items.length > 0) {
        parsed = data as OutlinerClipboardData;
      }
    } catch {
      return false;
    }
    if (!parsed) return false;

    const anchor = state.nodes[afterNodeId];
    if (!anchor) return false;

    pushHistorySnapshot(null);
    const allNodes = Object.values(state.nodes);
    const anchorNextSibling = getNextSibling(allNodes, anchor);

    const idMap = new Map<string, string>();
    parsed.items.forEach((item) => idMap.set(item.id, generateId()));

    let rootCursor: number | undefined = anchor.position;
    const childCursors = new Map<string, number | undefined>();

    const newNodes: OutlineNodeData[] = parsed.items.map((item) => {
      const newId = idMap.get(item.id)!;
      const mappedParentId = item.parentId ? idMap.get(item.parentId) ?? null : null;
      let position: number;
      let parentId: string | null;
      if (mappedParentId === null) {
        // 選択の「根っこ」だったノード: anchorと同じ階層の兄弟として、anchorの直後に順番に挿入する
        parentId = anchor.parentId;
        position = midpointPosition(rootCursor, anchorNextSibling?.position);
        rootCursor = position;
      } else {
        // 選択内の別ノードの子だったノード: 新しい親IDの下で元の相対順序を保って挿入する
        parentId = mappedParentId;
        position = midpointPosition(childCursors.get(mappedParentId), undefined);
        childCursors.set(mappedParentId, position);
      }
      return makeNode({
        id: newId,
        noteId: state.currentNoteId as string,
        parentId,
        position,
        content: item.content,
        nodeType: item.nodeType as OutlineNodeData["nodeType"],
        textColor: item.textColor,
      });
    });

    set((s) => {
      const next = { ...s.nodes };
      newNodes.forEach((n) => (next[n.id] = n));
      return { nodes: next, selectedNodeIds: newNodes.map((n) => n.id) };
    });
    newNodes.forEach((n) => void persistNode(n));
    return true;
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const currentSnapshot = state.nodes;
    lastHistoryGroupKey = null; // 直後の入力を新しいUndoグループとして扱う
    set({
      nodes: prevSnapshot,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot].slice(-HISTORY_LIMIT),
      selectedNodeIds: [],
      focusRequest: null,
      historyVersion: state.historyVersion + 1,
    });
    void persistSnapshotDiff(currentSnapshot, prevSnapshot);
  },
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const nextSnapshot = state.redoStack[state.redoStack.length - 1];
    const currentSnapshot = state.nodes;
    lastHistoryGroupKey = null;
    set({
      nodes: nextSnapshot,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot].slice(-HISTORY_LIMIT),
      selectedNodeIds: [],
      focusRequest: null,
      historyVersion: state.historyVersion + 1,
    });
    void persistSnapshotDiff(currentSnapshot, nextSnapshot);
  },

  reconnectSupabase: async () => {
    const ok = await connectSupabase();
    if (ok) {
      await get().loadFolders();
      await get().loadNotesList();
      const noteId = get().currentNoteId;
      if (noteId) await get().openNote(noteId);
    }
    return ok;
  },

  refreshPendingCount: async () => {
    await refreshPendingCount();
  },

  exportSnapshot: async () => {
    const [folders, notes, nodes] = await Promise.all([
      dbGetAllFolders(),
      dbGetAllNotes(),
      dbGetAllNodes(),
    ]);
    return { exportedAt: nowIso(), folders, notes, nodes };
  },

  importSnapshot: async (data) => {
    const snapshot = parseOutlineSnapshot(data);
    // フォルダ → メモ → ノードの順で書き込む(親子関係(parentId/folderId)の参照先が
    // 先に存在している状態にするため。IndexedDB/Supabaseどちらも外部キー的な
    // 整合性チェックがあるため、この順序を守る)
    for (const f of snapshot.folders) await persistFolder(f);
    for (const n of snapshot.notes) await persistNote(n);
    for (const nd of snapshot.nodes) await persistNode(nd);

    await get().loadFolders();
    await get().loadNotesList();
    const currentNoteId = get().currentNoteId;
    if (currentNoteId) {
      const localNodes = await dbGetNodesByNote(currentNoteId);
      set({ nodes: toMap(localNodes) });
    }

    return {
      folders: snapshot.folders.length,
      notes: snapshot.notes.length,
      nodes: snapshot.nodes.length,
    };
  },
}));

/** importSnapshotの入力を検証し、最低限の形が揃っているスナップショットへ整形する */
/**
 * importSnapshotの入力を検証し、最低限の形が揃っているスナップショットへ整形する。
 * JSONファイルは端末外から持ち込まれる「信頼できない入力」であるため、DOMへ
 * innerHTMLとして描画されるnode.contentは必ずsanitizeHtmlを通してから取り込む
 * (<script>やonerror等を仕込んだ改ざんファイルによるXSSを防ぐため)。
 */
function parseOutlineSnapshot(data: unknown): OutlineSnapshot {
  if (!data || typeof data !== "object") {
    throw new Error("JSONの形式が正しくありません");
  }
  const obj = data as Record<string, unknown>;
  const rawFolders = Array.isArray(obj.folders) ? obj.folders : [];
  const rawNotes = Array.isArray(obj.notes) ? obj.notes : [];
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const isValidRecord = (r: unknown): r is Record<string, unknown> =>
    !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string";
  if (
    !rawFolders.every(isValidRecord) ||
    !rawNotes.every(isValidRecord) ||
    !rawNodes.every(isValidRecord)
  ) {
    throw new Error("JSONの中身がこのアプリの書き出し形式と一致しません");
  }
  if (rawFolders.length === 0 && rawNotes.length === 0 && rawNodes.length === 0) {
    throw new Error("読み込めるデータがありませんでした");
  }

  const folders = (rawFolders as unknown as FolderData[]).map((f) => ({
    ...f,
    name: typeof f.name === "string" ? f.name : String(f.name ?? ""),
  }));
  const notes = (rawNotes as unknown as NoteData[]).map((n) => ({
    ...n,
    title: typeof n.title === "string" ? n.title : String(n.title ?? ""),
  }));
  const nodes = (rawNodes as unknown as OutlineNodeData[]).map((n) => ({
    ...n,
    content: sanitizeHtml(typeof n.content === "string" ? n.content : ""),
  }));

  return { exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : nowIso(), folders, notes, nodes };
}

// ============================================================
// 永続化・同期処理(Supabase / IndexedDB)
// ストアのactionsから呼ばれるが、循環参照を避けるためストア定義の外側に置く。
// ============================================================

/**
 * folders/notes/nodesの全変更を1本のRealtimeチャンネルにまとめて購読する
 * (テーブルごとに別チャンネルを張らない)。userIdが確定している間ずっと有効で、
 * 開いているメモに関わらず常時購読する。
 */
let syncChannel: RealtimeChannel | null = null;
let syncChannelUserId: string | null = null;
let syncChannelReconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** 切断/エラー検知後、再購読を試みるまでの待機時間。タイトな再接続ループを避ける */
const SYNC_CHANNEL_RECONNECT_DELAY_MS = 2000;

/**
 * folders/notes/nodesの変更を1本のチャンネルで購読する。切断・タイムアウト・
 * エラー(CHANNEL_ERROR/TIMED_OUT/CLOSED)を検知した場合は、一定時間後に
 * 自動的に張り直す(userIdがまだ有効な間だけ)。
 */
function subscribeSyncChannel(userId: string): void {
  const client = getSupabaseClient();
  if (!client) return;

  teardownSyncChannel();
  syncChannelUserId = userId;

  console.log("[Sync] Realtimeチャンネルの購読を開始します userId=", userId);
  syncChannel = client
    .channel(`sync-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "folders", filter: `user_id=eq.${userId}` },
      handleFolderRealtimeChange
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${userId}` },
      handleNoteRealtimeChange
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "nodes", filter: `user_id=eq.${userId}` },
      handleNodeRealtimeChange
    )
    .subscribe((status, err) => {
      console.log("[Sync] Realtimeチャンネルの状態:", status, err?.message ?? "");
      if (status === "SUBSCRIBED") {
        if (syncChannelReconnectTimer) {
          clearTimeout(syncChannelReconnectTimer);
          syncChannelReconnectTimer = null;
        }
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        scheduleSyncChannelReconnect(userId);
      }
    });
}

/** 切断/エラーを検知した際、少し待ってから自動的に再購読する(多重予約はしない) */
function scheduleSyncChannelReconnect(userId: string): void {
  if (syncChannelReconnectTimer) return;
  console.log("[Sync] Realtimeチャンネルが切断/エラーになりました。再接続を予約します");
  syncChannelReconnectTimer = setTimeout(() => {
    syncChannelReconnectTimer = null;
    // 待機中にサインアウト/別ユーザーへの切替が起きていないか確認してから張り直す
    if (useOutlineStore.getState().userId === userId) {
      subscribeSyncChannel(userId);
    }
  }, SYNC_CHANNEL_RECONNECT_DELAY_MS);
}

/** サインアウト等でセッションが失われた際、Realtimeチャンネルを確実に解除する */
function teardownSyncChannel(): void {
  if (syncChannelReconnectTimer) {
    clearTimeout(syncChannelReconnectTimer);
    syncChannelReconnectTimer = null;
  }
  syncChannelUserId = null;
  if (syncChannel) {
    const client = getSupabaseClient();
    if (client) void client.removeChannel(syncChannel);
    syncChannel = null;
  }
}

// ============================================================
// BroadcastChannel: 同一ブラウザ内の複数タブ間を、Supabase Realtimeの往復
// (ネットワークを挟むため数十〜数百ms)を待たずに即座(数ms)に同期する補強策。
// 認証/オンライン状態に関わらず、ローカルへ書き込むたびに必ず送る
// (オフライン中の編集も同一ブラウザの他タブへはこれで即時反映される)。
// ============================================================
const BROADCAST_CHANNEL_NAME = "outliner-sync-v1";

type BroadcastMessage =
  | { table: "folders"; op: "upsert"; row: FolderData }
  | { table: "folders"; op: "delete"; id: string }
  | { table: "notes"; op: "upsert"; row: NoteData }
  | { table: "notes"; op: "delete"; id: string }
  | { table: "nodes"; op: "upsert"; row: OutlineNodeData }
  | { table: "nodes"; op: "delete"; id: string };

let syncBroadcastChannel: BroadcastChannel | null = null;

function getSyncBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!syncBroadcastChannel) {
    syncBroadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    syncBroadcastChannel.onmessage = (event) => {
      try {
        handleBroadcastMessage(event.data as BroadcastMessage);
      } catch (err) {
        devError(
          "[sync] BroadcastChannelメッセージの処理に失敗しました:",
          err instanceof Error ? err.message : err
        );
      }
    };
  }
  return syncBroadcastChannel;
}

/** ローカルでの変更を、同一ブラウザの他タブへBroadcastChannel経由で即座に伝える */
function postBroadcast(message: BroadcastMessage): void {
  getSyncBroadcastChannel()?.postMessage(message);
}

/**
 * 他タブからのBroadcastChannelメッセージを、Realtimeの受信ハンドラと同じ
 * updatedAt比較でローカル(Zustand/IndexedDB)へ反映する。送信元のタブが既に
 * Supabaseへの同期を担当しているため、ここではネットワークへの再送は一切行わない
 * (BroadcastChannelは送信元自身には配送されない仕様のため、自己エコーの心配も無い)。
 */
function handleBroadcastMessage(message: BroadcastMessage): void {
  if (message.table === "folders") {
    if (message.op === "delete") {
      useOutlineStore.setState((s) => ({ folders: s.folders.filter((f) => f.id !== message.id) }));
      void dbDeleteFolderLocal(message.id);
      return;
    }
    const incoming = message.row;
    const existing = useOutlineStore.getState().folders.find((f) => f.id === incoming.id);
    if (existing && existing.updatedAt >= incoming.updatedAt) return;
    useOutlineStore.setState((s) => ({
      folders: sortFolders(
        existing ? s.folders.map((f) => (f.id === incoming.id ? incoming : f)) : [...s.folders, incoming]
      ),
    }));
    void dbPutFolder(incoming);
    return;
  }

  if (message.table === "notes") {
    if (message.op === "delete") {
      useOutlineStore.setState((s) => ({
        notesList: s.notesList.filter((n) => n.id !== message.id),
        ...(s.currentNoteId === message.id ? { currentNoteId: null, nodes: {}, activeNodeId: null } : {}),
      }));
      void dbDeleteNoteLocal(message.id);
      return;
    }
    const incoming = message.row;
    const existing = useOutlineStore.getState().notesList.find((n) => n.id === incoming.id);
    if (existing && existing.updatedAt >= incoming.updatedAt) return;
    useOutlineStore.setState((s) => ({
      notesList: sortNotes(
        existing ? s.notesList.map((n) => (n.id === incoming.id ? incoming : n)) : [...s.notesList, incoming]
      ),
    }));
    void dbPutNote(incoming);
    return;
  }

  // table === "nodes"
  if (message.op === "delete") {
    void dbDeleteNode(message.id);
    useOutlineStore.setState((s) => {
      if (!(message.id in s.nodes)) return s;
      const next = { ...s.nodes };
      delete next[message.id];
      return { nodes: next };
    });
    return;
  }
  const incoming = message.row;
  void dbPutNode(incoming);
  const state = useOutlineStore.getState();
  if (state.currentNoteId !== incoming.noteId) return;
  const existing = state.nodes[incoming.id];
  if (existing && existing.updatedAt >= incoming.updatedAt) return;
  useOutlineStore.setState((s) => ({ nodes: { ...s.nodes, [incoming.id]: incoming } }));
}

// ============================================================
// Undo/Redo履歴
// nodesスナップショット(mapまるごと)をスタックに積む簡易実装。個々の操作ごとに
// 逆操作を書く代わりにスナップショット差分で十分な粒度・確実性が得られるため、
// この方式を採用している。同じノードへの連続入力(通常のタイピング)は
// groupKeyが同じ間は1ステップにまとめ、Undoが「1文字ごと」にならないようにする。
// ============================================================
const HISTORY_LIMIT = 100;
const HISTORY_GROUP_WINDOW_MS = 1200;
let lastHistoryGroupKey: string | null = null;
let lastHistoryPushAt = 0;

/** 変更を加える直前に呼び、直前の状態をUndoスタックへ積む(Redoスタックはクリアする) */
function pushHistorySnapshot(groupKey: string | null): void {
  const state = useOutlineStore.getState();
  const now = Date.now();
  const sameGroup =
    groupKey !== null && groupKey === lastHistoryGroupKey && now - lastHistoryPushAt < HISTORY_GROUP_WINDOW_MS;
  lastHistoryGroupKey = groupKey;
  lastHistoryPushAt = now;
  if (sameGroup) return;
  const nextStack = [...state.undoStack, state.nodes].slice(-HISTORY_LIMIT);
  useOutlineStore.setState({ undoStack: nextStack, redoStack: [] });
}

/** Undo/Redoでnodesマップを丸ごと差し替えた際、実際に変化した分だけをIndexedDB/Supabaseへ反映する */
async function persistSnapshotDiff(
  before: Record<string, OutlineNodeData>,
  after: Record<string, OutlineNodeData>
): Promise<void> {
  const changedOrNew: OutlineNodeData[] = [];
  const removedIds: string[] = [];
  for (const id of Object.keys(after)) {
    if (before[id] !== after[id]) changedOrNew.push(after[id]);
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) removedIds.push(id);
  }
  for (const n of changedOrNew) await persistNode(n);
  if (removedIds.length > 0) {
    await persistDeleteNodes(removedIds, useOutlineStore.getState().currentNoteId);
  }
}

function toMap(nodes: OutlineNodeData[]): Record<string, OutlineNodeData> {
  const map: Record<string, OutlineNodeData> = {};
  nodes.forEach((n) => (map[n.id] = n));
  return map;
}

/**
 * Supabaseへの同期成功を記録する。syncStatusを"saved"にするのに加えて、
 * データ保護ステータスのモーダルに表示する「最終同期日時」も更新・永続化する
 * (頻繁に呼ばれるためIndexedDBへの書き込みは投げっぱなしにし、待ち合わせない)
 */
/**
 * Supabase呼び出しをtry/catchで包み、ネットワーク例外(完全なオフライン化・DNS失敗・
 * タイムアウト等でfetch自体が例外を投げるケース)もPostgrestErrorと同じ{error}形へ
 * 正規化する共通ラッパー。supabase-jsは通常APIエラーを{error}フィールドとして返すが、
 * 接続そのものが失敗した場合は例外を投げることがあるため、どちらの経路でも必ず
 * 同じエラーハンドリング(dirty化・再送キュー登録・syncStatus更新)を通るようにし、
 * ネットワーク瞬断時にローカルの変更が黙って失われる(=再送キューに載らない)ことを防ぐ。
 */
/**
 * Supabaseへの通信がネットワークの都合等で例外もエラーも返さないままいつまでも
 * 応答しない場合に備えたタイムアウト。これが無いと、fetchが宙に浮いたままawaitし
 * 続けることになり、コンソールには何のエラーも出ないのに同期状態(syncStatus)が
 * "saving"のまま永遠に遷移しない、という診断しづらい停滞を招く。
 */
const SUPABASE_CALL_TIMEOUT_MS = 5000;

async function safeCall<F extends () => PromiseLike<{ error: { message: string } | null }>>(
  fn: F
): Promise<Awaited<ReturnType<F>>> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Supabaseへの通信がタイムアウトしました")),
          SUPABASE_CALL_TIMEOUT_MS
        )
      ),
    ]);
    return result as Awaited<ReturnType<F>>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "ネットワークエラーが発生しました";
    console.log("[Sync] Supabaseへの通信が失敗/タイムアウトしました:", message);
    return {
      error: { message },
    } as Awaited<ReturnType<F>>;
  }
}

/** 409 Conflict / 23505 (unique_violation) をエラーメッセージから判定する */
function isConflictError(message: string): boolean {
  return /409/.test(message) || /23505/.test(message) || /duplicate key/i.test(message) || /conflict/i.test(message);
}

/**
 * テーブルごとに「Supabase上に既に存在するとわかっているid」を憶えておく、
 * ページ滞在中だけ有効な軽量フラグ。サーバから取得できた行のid、insert/updateに
 * 成功した行のidをここに積み、次にそのidを送るときはinsertではなくupdateを
 * 選ぶ判定に使う(.upsert()を一切使わずにinsert/updateを明示的に振り分けるための土台)。
 * 万一この判定を誤っても、safeWriteが逆操作へ自動フォールバックするため実害はない。
 */
const knownRemoteIds = new Map<SyncTable, Set<string>>();

function markKnownRemote(table: SyncTable, ids: Iterable<string>): void {
  let set = knownRemoteIds.get(table);
  if (!set) {
    set = new Set();
    knownRemoteIds.set(table, set);
  }
  for (const id of ids) set.add(id);
}

function isKnownRemote(table: SyncTable, id: string): boolean {
  return knownRemoteIds.get(table)?.has(id) ?? false;
}

/** 複数の新規行をまとめて1回のinsert([...])で送る(POSTリクエスト) */
async function tryInsert(
  client: SupabaseClient,
  table: SyncTable,
  rows: Array<NodeRow | NoteRowType | FolderRowType>
): Promise<{ error: { message: string } | null }> {
  if (rows.length === 0) return { error: null };
  return safeCall(() => client.from(table).insert(rows));
}

/**
 * 1件をupdate().eq('id', id)で送る(PATCHリクエスト)。PostgRESTはeq条件に一致する
 * 行が無くてもエラーにはならず0件更新で成功扱いになるため、.select('id')を付けて
 * 実際に更新された行があったかどうかを戻り値のdata件数で判定する
 * (0件なら「実はまだ存在しなかった」とみなし、呼び出し元でinsertへフォールバックする)。
 */
async function tryUpdate(
  client: SupabaseClient,
  table: SyncTable,
  id: string,
  row: NodeRow | NoteRowType | FolderRowType
): Promise<{ affected: boolean; error: { message: string } | null }> {
  const { data, error } = await safeCall(() => client.from(table).update(row).eq("id", id).select("id"));
  if (error) return { affected: false, error };
  const affected = Array.isArray(data) && data.length > 0;
  return { affected, error: null };
}

/**
 * .upsert()を一切使わず、既存/新規かをローカルの既知フラグ(knownRemoteIds)で判定して
 * update または insert を明示的に発行する安全な1件書き込み。判定が誤っていた場合に
 * 備えて、どちらの経路でも逆操作(insert⇄update)への自動フォールバックを行うため、
 * ブラウザコンソールに409 Conflict / 23505 (unique_violation) が露出することは無い。
 */
async function safeWrite(
  client: SupabaseClient,
  table: SyncTable,
  id: string,
  row: NodeRow | NoteRowType | FolderRowType
): Promise<{ error: { message: string } | null }> {
  if (isKnownRemote(table, id)) {
    const updated = await tryUpdate(client, table, id, row);
    if (updated.affected) {
      markKnownRemote(table, [id]);
      return { error: null };
    }
    if (updated.error && !isConflictError(updated.error.message)) return { error: updated.error };

    console.log(`[Sync] ${table}(${id})のupdateが不成立/衝突のため、insertへフォールバックします`);
    const inserted = await tryInsert(client, table, [row]);
    if (!inserted.error) {
      markKnownRemote(table, [id]);
      return { error: null };
    }
    // insertも失敗した(=実は既に存在していた等)なら、最後にもう一度updateを試す
    console.log(`[Sync] ${table}(${id})のinsertフォールバックにも失敗。updateを再試行します:`, inserted.error.message);
    const retried = await tryUpdate(client, table, id, row);
    if (retried.affected) {
      markKnownRemote(table, [id]);
      return { error: null };
    }
    return { error: retried.error ?? inserted.error };
  }

  const inserted = await tryInsert(client, table, [row]);
  if (!inserted.error) {
    markKnownRemote(table, [id]);
    return { error: null };
  }
  if (!isConflictError(inserted.error.message)) return { error: inserted.error };

  console.log(`[Sync] ${table}(${id})のinsertが409/23505のため、updateへフォールバックします`);
  const updated = await tryUpdate(client, table, id, row);
  if (updated.affected) {
    markKnownRemote(table, [id]);
    return { error: null };
  }
  return { error: updated.error ?? inserted.error };
}

/**
 * notesのfolder_idが現在のfolders一覧に存在しない(フォルダが削除された・
 * 別端末側の変更がまだ反映されていない等)場合、外部キー制約違反
 * (notes_folder_id_fkey)を未然に防ぐため、送信直前にnull(フォルダなし/
 * ルート階層)へ自動的に補正する。
 */
function sanitizeNoteRowFolderRef(row: NoteRowType): NoteRowType {
  if (!row.folder_id) return row;
  const exists = useOutlineStore.getState().folders.some((f) => f.id === row.folder_id);
  if (exists) return row;
  console.log(
    `[Sync] notes(${row.id})のfolder_id=${row.folder_id}が現在のfolders一覧に存在しないため、nullへ補正します`
  );
  return { ...row, folder_id: null };
}

/**
 * 指定テーブルの行群を、新規/既存を問わずまとめて1回のupsert(rows, { onConflict: 'id' })
 * で送信する(通信回数・待ち時間が最小になる正規ルート)。onConflict指定により、
 * 既存idは更新・新規idは挿入がPostgRES側で自動的に振り分けられるため、通常運用で
 * 409/23505がここで表面化することは無い。
 * ごくまれにバッチ全体が失敗した場合(ネットワーク瞬断・予期しない制約違反等)だけ、
 * 1件ずつinsert/updateへ明示的に振り分け、双方向フォールバック(safeWrite)で確実に
 * 反映させる保険ルートへ切り替える。これにより結果的に409/23505がコンソールへ
 * 表面化することは無い。
 */
async function syncRowsToTable(
  client: SupabaseClient,
  table: SyncTable,
  rows: Array<NodeRow | NoteRowType | FolderRowType>
): Promise<Set<string>> {
  const failedIds = new Set<string>();
  if (rows.length === 0) return failedIds;

  // notesはFK制約(notes_folder_id_fkey)違反を未然に防ぐため、送信直前に補正しておく
  const sanitizedRows =
    table === "notes" ? (rows as NoteRowType[]).map(sanitizeNoteRowFolderRef) : rows;

  const { error } = await safeCall(() =>
    client.from(table).upsert(sanitizedRows, { onConflict: "id", ignoreDuplicates: false })
  );
  if (!error) {
    markKnownRemote(
      table,
      sanitizedRows.map((r) => r.id)
    );
    return failedIds;
  }

  console.log(`[Sync] ${table}の一括upsertが失敗したため、1件ずつ再適用します:`, error.message);
  const results = await Promise.all(sanitizedRows.map((row) => safeWrite(client, table, row.id, row)));
  results.forEach((result, i) => {
    if (result.error) {
      devError(`[sync] ${table}(${sanitizedRows[i].id})の保存に失敗しました:`, result.error.message);
      failedIds.add(sanitizedRows[i].id);
    }
  });

  return failedIds;
}

/**
 * Supabaseへの同期リクエストをテーブル単位でまとめて軽量化するバッチキュー。
 * persistNode/persistNote/persistFolderは呼ばれるたびに即座に通信するのではなく、
 * ここへ「そのidの最新の行データ」を積むだけにする。同じidに何度persistしても
 * キュー上では1件に上書きされ、編集が止まってからSYNC_DEBOUNCE_MS(3000ms)その
 * idへの追加編集が無ければ送信される(id単位のデバウンス)。発火時にはその時点で
 * テーブルに溜まっている他のidも巻き込んでまとめて送るため、複数レコードを
 * 編集した場合も機会があれば1回の送信にまとまる。タブ離脱時はflushAllPendingSyncが
 * このタイマーを待たずに即時フラッシュする。
 */
/** 編集が完全に止まってからこの時間が経つまでは通信しない(操作停止から3秒後の
 *  自動バッチ同期)。タブを離れる/閉じる場合はこのタイマーを待たずflushAllPendingSyncで
 *  即時送信されるため、体感の遅延なく取りこぼしも防げる。 */
const SYNC_DEBOUNCE_MS = 3000;
/** タイムアウト等で送れなかった変更を、ユーザー操作が無くても自動的に拾い直す間隔 */
const BACKGROUND_RETRY_INTERVAL_MS = 8000;
const pendingSyncRows = new Map<SyncTable, Map<string, NodeRow | NoteRowType | FolderRowType>>();
const syncFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function queueRowForSync(table: SyncTable, id: string, row: NodeRow | NoteRowType | FolderRowType): void {
  let tableQueue = pendingSyncRows.get(table);
  if (!tableQueue) {
    tableQueue = new Map();
    pendingSyncRows.set(table, tableQueue);
  }
  tableQueue.set(id, row);

  // デバウンスはid単位: 同じidへの連続編集は1回に集約しつつ、無関係な他のidの送信が
  // ずっと編集され続ける1件によって際限なく遅延させられる(=飢餓状態になる)ことを防ぐ
  const timerKey = `${table}:${id}`;
  const existingTimer = syncFlushTimers.get(timerKey);
  if (existingTimer) clearTimeout(existingTimer);
  syncFlushTimers.set(
    timerKey,
    setTimeout(() => {
      syncFlushTimers.delete(timerKey);
      void flushTableQueue(table);
    }, SYNC_DEBOUNCE_MS)
  );
}

/**
 * テーブル間の外部キー依存順序: notesはfolder_idでfolders、nodesはnote_idでnotesを
 * 参照する。新しいフォルダへ作成直後のメモを移動したり、新規メモ作成直後にその
 * 1行目ノードを編集したりした場合、参照先(親)がまだリモートに存在しないまま
 * 子を送ってしまうと外部キー制約違反になる。それを防ぐため、子テーブルを
 * flushする前に親テーブル側の保留中キューがあれば必ず先にflush(完了を保証)する。
 */
const SYNC_TABLE_DEPENDS_ON: Partial<Record<SyncTable, SyncTable>> = {
  notes: "folders",
  nodes: "notes",
};

/** キューに溜まった特定テーブルの全行を、insert/updateへ振り分けてまとめて送信する */
async function flushTableQueue(table: SyncTable): Promise<void> {
  // 親テーブル(folders→notes→nodes)の保留分が残っていれば、直列に先に完了させる
  const dependsOn = SYNC_TABLE_DEPENDS_ON[table];
  if (dependsOn && (pendingSyncRows.get(dependsOn)?.size ?? 0) > 0) {
    console.log(`[Sync] ${table}の送信前に、依存先の${dependsOn}を先に同期します`);
    for (const timerKey of Array.from(syncFlushTimers.keys())) {
      if (timerKey.startsWith(`${dependsOn}:`)) {
        clearTimeout(syncFlushTimers.get(timerKey));
        syncFlushTimers.delete(timerKey);
      }
    }
    await flushTableQueue(dependsOn);
  }

  const tableQueue = pendingSyncRows.get(table);
  if (!tableQueue || tableQueue.size === 0) return;
  const ids = Array.from(tableQueue.keys());
  const rows = Array.from(tableQueue.values());
  pendingSyncRows.delete(table);

  const client = getSupabaseClient();
  const { userId } = useOutlineStore.getState();
  if (!client || !userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    // 送信できない状況ならdirtyへ戻し、オンライン復帰時にflushPendingSyncで再送されるようにする
    await Promise.all(ids.map((id) => dbMarkDirty(table, id)));
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }

  console.log(`[Sync] ${table}をバッチ送信します (${rows.length}件, id=${ids.join(",")})`);
  const failedIds = await syncRowsToTable(client, table, rows);
  const succeededIds = ids.filter((id) => !failedIds.has(id));
  if (succeededIds.length > 0) await Promise.all(succeededIds.map((id) => dbClearDirty(table, id)));
  if (failedIds.size > 0) {
    // タイムアウトや一時的な通信障害でも、画面を「同期エラー」や「同期中…」のまま
    // 固まらせない。syncStatusを"idle"へ戻すことでAutosaveIndicatorの表示は
    // pendingCount(このあとdirty化する分)を見た「同期中…(送信待ちN件)」表示へ
    // フォールバックし、バックグラウンドの定期リトライ・オンライン復帰・タブ復帰時に
    // 自動的に再送される(dirtyのまま残すのでデータが失われることは無い)。
    console.log(`[Sync] ${table}のバッチ送信で失敗した行があります(バックグラウンドで再試行します):`, Array.from(failedIds).join(","));
    await Promise.all(Array.from(failedIds).map((id) => dbMarkDirty(table, id)));
    useOutlineStore.setState({ syncStatus: "idle" });
    void refreshPendingCount();
  } else {
    markSynced();
  }
}

/**
 * デバウンス待ちの全テーブルの保留中キューを、タイマーを待たずに今すぐ送信する。
 * タブが非表示になる/閉じられる直前に呼び、3秒デバウンスの間に発生した「まだ
 * 送信していない編集」が失われる(次にタブを開くまで未送信のまま)ことを防ぐ。
 * fire-and-forgetで呼ぶ想定(unload系のイベントハンドラは完了を待てないため)。
 */
function flushAllPendingSync(): void {
  const tables = Array.from(pendingSyncRows.keys()).filter((table) => (pendingSyncRows.get(table)?.size ?? 0) > 0);
  if (tables.length === 0) return;
  console.log("[Sync] 保留中の同期キューを即時フラッシュします:", tables.join(","));
  for (const table of tables) {
    // このテーブルのidに紐づくデバウンスタイマーは、これから即時flushするため不要になる
    for (const timerKey of Array.from(syncFlushTimers.keys())) {
      if (timerKey.startsWith(`${table}:`)) {
        clearTimeout(syncFlushTimers.get(timerKey));
        syncFlushTimers.delete(timerKey);
      }
    }
    void flushTableQueue(table);
  }
}

/**
 * 現在開いているメモのノードだけを対象に、リモートの最新状態を取得してローカルへ
 * マージする(openNoteと違い、undo履歴やフォーカス状態はリセットしない)。
 * タブがバックグラウンドから復帰した際、他端末での変更を取りこぼさないために使う。
 */
async function refreshCurrentNoteNodesFromRemote(noteId: string): Promise<void> {
  const client = getSupabaseClient();
  const { userId } = useOutlineStore.getState();
  if (!client || !userId) return;

  const { data, error } = await safeCall(() => client.from("nodes").select("*").eq("note_id", noteId));
  if (error) {
    devError("[sync] ノードの再取得に失敗しました:", error.message);
    return;
  }
  if (!data) return;
  const remoteNodes = (data as NodeRow[]).map(nodeFromRow);
  markKnownRemote(
    "nodes",
    remoteNodes.map((n) => n.id)
  );
  // タブが非表示だった間に別のメモへ遷移していた場合は反映しない
  if (useOutlineStore.getState().currentNoteId !== noteId) return;
  const localNodesBeforeMerge = Object.values(useOutlineStore.getState().nodes);
  void clearDirtyForRemoteWins("nodes", localNodesBeforeMerge, remoteNodes);
  const merged = mergeByUpdatedAt(localNodesBeforeMerge, remoteNodes);
  await dbPutNodes(merged);
  if (useOutlineStore.getState().currentNoteId === noteId) {
    useOutlineStore.setState({ nodes: toMap(merged) });
    maybeAutoTitleFromFirstNode(noteId, useOutlineStore.getState().nodes);
  }
}

let refreshingFromRemote = false;

/**
 * タブ/ウィンドウがバックグラウンドから復帰した際に、リモートとの差分を取り込みつつ
 * 未送信キューもフラッシュして最新化する(起動時のinit()と同じ考え方を、
 * 復帰のたびにも軽く適用する)。folders/notes一覧とnodesの取得はPromise.allで
 * 並行に行うため、iPad PWAの復帰直後でも体感的に一瞬で最新化が終わる。
 * visibilitychangeとwindow.onfocusがほぼ同時に発火しても二重に走らないよう、
 * 実行中は多重起動をガードする。
 */
async function refreshFromRemote(): Promise<void> {
  if (refreshingFromRemote) return;
  const client = getSupabaseClient();
  const { userId, isOnline } = useOutlineStore.getState();
  if (!client || !userId || !isOnline) return;

  refreshingFromRemote = true;
  try {
    console.log("[Sync] 復帰によるリモート差分の取得を開始します");
    const state = useOutlineStore.getState();
    const noteId = state.currentNoteId;
    await Promise.all([
      state.loadFolders(),
      state.loadNotesList(),
      noteId ? refreshCurrentNoteNodesFromRemote(noteId) : Promise.resolve(),
    ]);
    await flushPendingSync();
    console.log("[Sync] 復帰によるリモート差分の取得が完了しました");
  } finally {
    refreshingFromRemote = false;
  }
}

/** ノート内の「1行目」(親を持たないルートノードのうち、positionが最小のもの)を探す */
function getFirstRootNode(nodes: Record<string, OutlineNodeData>): OutlineNodeData | null {
  let best: OutlineNodeData | null = null;
  for (const n of Object.values(nodes)) {
    if (n.parentId !== null) continue;
    if (!best || n.position < best.position) best = n;
  }
  return best;
}

/**
 * メモのタイトルが未設定(空文字)またはデフォルトの「無題のメモ」のままなら、
 * 1行目(先頭のルートノード)の「テキスト全体」を自動でタイトルへ反映する
 * (サイドバー・ヘッダーのタイトル一覧が「無題のメモ」だらけになるのを防ぐ)。
 *
 * previousFirstLineTitleには、この変更が起きる直前の1行目から導かれるはずだった
 * タイトル(=直前にauto-titleが追従していたなら一致するはずの値)を渡す。現在のタイトルが
 * それと一致する(＝まだ自動追従中)場合のみ上書きし、ユーザーが手動で別の文字列に
 * 変更していた場合は上書きしない。これが無いと、1文字目を入力した直後にタイトルが
 * デフォルト文字列("無題のメモ"や空文字)と一致しなくなり、2文字目以降まったく
 * 追従しなくなる(=タイトルが1文字で固定される)バグになる。
 */
function maybeAutoTitleFromFirstNode(
  noteId: string,
  nodes: Record<string, OutlineNodeData>,
  previousFirstLineTitle?: string
): void {
  const note = useOutlineStore.getState().notesList.find((n) => n.id === noteId);
  if (!note) return;
  const wasFollowing =
    note.title === "" || note.title === DEFAULT_NOTE_TITLE || note.title === previousFirstLineTitle;
  if (!wasFollowing) return;

  const first = getFirstRootNode(nodes);
  if (!first) return;
  const plain = htmlToPlainText(first.content).trim().slice(0, 100);
  const newTitle = plain || DEFAULT_NOTE_TITLE;
  if (newTitle === note.title) return;

  useOutlineStore.getState().renameNote(noteId, newTitle);
}

function markSynced(): void {
  const now = nowIso();
  console.log("[Sync] クラウド同期済み(Supabase)にステータスを更新します", now);
  useOutlineStore.setState({ syncStatus: "saved", lastSyncedAt: now });
  void dbSetMeta("lastSyncedAt", now);
  void refreshPendingCount();
}

/**
 * IndexedDB上の未送信件数(dirty + pendingDeletes)を数え直し、storeへ反映する。
 * データ保護ステータスの表示(「クラウド同期済み」か「同期待ちがある」か)を
 * 実際のローカルキューの残数と正しく連動させるために使う。
 */
async function refreshPendingCount(): Promise<void> {
  const [dirty, pendingDeletes] = await Promise.all([dbGetAllDirty(), dbGetPendingDeletes()]);
  useOutlineStore.setState({ pendingCount: dirty.length + pendingDeletes.length });
}

/**
 * Supabaseへの接続(匿名サインイン)を確立し、成功したら未送信分の同期キューを
 * 即座に処理する。起動時・オンライン復帰時・手動再接続ボタンのすべてから呼ばれる
 * 共通の入口(二重実行は`reconnecting`フラグで防ぐ)。
 */
async function connectSupabase(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    console.log("[Sync] Supabaseクライアントが無いため接続処理をスキップします(ローカル専用モード)");
    return false;
  }
  if (useOutlineStore.getState().reconnecting) {
    console.log("[Sync] 接続処理が既に進行中のため、今回の呼び出しはスキップします");
    return false;
  }

  console.log("[Sync] Supabaseへの接続確認(匿名認証)を開始します");
  useOutlineStore.setState({ reconnecting: true });
  try {
    const session = await ensureAnonymousSession();
    const userId = session?.user.id ?? null;
    useOutlineStore.setState({ userId });
    if (!userId) {
      console.log("[Sync] 匿名認証が完了しなかったため、クラウド同期済みにはできません");
      useOutlineStore.setState({
        syncStatus: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error",
      });
      return false;
    }
    console.log("[Sync] 匿名認証が完了しました。未送信分の同期キューを処理します userId=", userId);
    await flushPendingSync();
    // PC⇄iPad間・複数タブ間などの他端末/他タブでの変更をリアルタイムに拾うため、
    // folders/notes/nodesをまとめた単一チャンネルの購読を開始する
    // (画面全体の再取得は行わず、差分IDのみをピンポイントで反映する)
    subscribeSyncChannel(userId);
    console.log("[Sync] Supabaseとの接続・認証が確定しました。ステータスを更新します");
    markSynced();
    return true;
  } catch (err) {
    // IndexedDBの一時的な失敗等、予期しない例外が起きてもクラッシュさせず
    // エラー状態として扱う(呼び出し元は再接続ボタンで再試行できる)
    devError("[supabase] 接続処理で予期しないエラーが発生しました:", err instanceof Error ? err.message : err);
    console.log(
      "[Sync] 接続処理で予期しないエラーが発生しました:",
      err instanceof Error ? err.message : err
    );
    useOutlineStore.setState({ syncStatus: "error" });
    return false;
  } finally {
    useOutlineStore.setState({ reconnecting: false });
  }
}

function sortNotes(notes: NoteData[]): NoteData[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sortFolders(folders: FolderData[]): FolderData[] {
  return [...folders].sort((a, b) => a.position - b.position);
}

/** targetIdがancestorIdの子孫(またはancestorId自身)かどうか(フォルダの循環移動防止に使う) */
function isFolderSelfOrDescendant(
  folders: FolderData[],
  ancestorId: string,
  targetId: string
): boolean {
  if (ancestorId === targetId) return true;
  let current = folders.find((f) => f.id === targetId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = folders.find((f) => f.id === current!.parentId);
  }
  return false;
}

const noteTouchTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * ノード編集のたびに、所属するメモの更新日時をローカルの一覧上でも更新する
 * (サイドバーの「最近編集した順」を成立させるため)。頻繁な書き込みを避けるため軽くデバウンスする。
 * Supabaseへは他の変更のついでに同期されるため、ここでは送らない。
 */
function touchNoteTimestamp(noteId: string): void {
  const existing = noteTouchTimers.get(noteId);
  if (existing) clearTimeout(existing);
  noteTouchTimers.set(
    noteId,
    setTimeout(() => {
      noteTouchTimers.delete(noteId);
      const state = useOutlineStore.getState();
      const note = state.notesList.find((n) => n.id === noteId);
      if (!note) return;
      const updated: NoteData = { ...note, updatedAt: nowIso() };
      useOutlineStore.setState({
        notesList: sortNotes(state.notesList.map((n) => (n.id === noteId ? updated : n))),
      });
      void dbPutNote(updated);
    }, 1500)
  );
}

async function persistNode(node: OutlineNodeData): Promise<void> {
  touchNoteTimestamp(node.noteId);
  await dbPutNode(node);
  // Supabase Realtimeの往復を待たず、同一ブラウザの他タブへは即座に伝える
  postBroadcast({ table: "nodes", op: "upsert", row: node });

  const client = getSupabaseClient();
  if (!client) {
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }
  const { userId } = useOutlineStore.getState();
  if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    await dbMarkDirty("nodes", node.id);
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }

  // 即座に通信はせず、バッチキューに積むだけにする(SYNC_DEBOUNCE_MS後にまとめて送信)。
  // dirty化はここで先に行っておくことで、送信が完了する前にページを閉じても
  // 次回起動時のflushPendingSyncで確実に再送される。
  await dbMarkDirty("nodes", node.id);
  useOutlineStore.setState({ syncStatus: "saving" });
  queueRowForSync("nodes", node.id, nodeToRow(node, userId));
}

async function persistDeleteNodes(ids: string[], noteId?: string | null): Promise<void> {
  if (ids.length === 0) return;
  if (noteId) touchNoteTimestamp(noteId);
  await dbDeleteNodes(ids);
  ids.forEach((id) => postBroadcast({ table: "nodes", op: "delete", id }));

  const client = getSupabaseClient();
  if (!client) {
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }
  const { userId } = useOutlineStore.getState();
  if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    await Promise.all(ids.map((id) => dbAddPendingDelete("nodes", id)));
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }
  // 複数件まとめて削除する場合も、渡されたid全件をリモートから消す(先頭1件だけの削除だと
  // 残りが同期時に復活してしまうため)
  const { error } = await safeCall(() => client.from("nodes").delete().in("id", ids));
  if (error) {
    devError("[sync] ノードの削除に失敗しました:", error.message);
    await Promise.all(ids.map((id) => dbAddPendingDelete("nodes", id)));
    useOutlineStore.setState({ syncStatus: "error" });
  } else {
    markSynced();
  }
}

async function persistNote(note: NoteData): Promise<void> {
  await dbPutNote(note);
  postBroadcast({ table: "notes", op: "upsert", row: note });

  const client = getSupabaseClient();
  if (!client) {
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }
  const { userId } = useOutlineStore.getState();
  if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    await dbMarkDirty("notes", note.id);
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }

  await dbMarkDirty("notes", note.id);
  useOutlineStore.setState({ syncStatus: "saving" });
  queueRowForSync("notes", note.id, noteToRow(note, userId));
}

async function persistDeleteNoteFull(noteId: string, nodeIds: string[]): Promise<void> {
  await dbDeleteNodes(nodeIds);
  await dbDeleteNoteLocal(noteId);
  nodeIds.forEach((id) => postBroadcast({ table: "nodes", op: "delete", id }));
  postBroadcast({ table: "notes", op: "delete", id: noteId });

  const client = getSupabaseClient();
  if (!client) return;
  const { userId } = useOutlineStore.getState();
  if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    await dbAddPendingDelete("notes", noteId);
    return;
  }
  const { error } = await safeCall(() => client.from("notes").delete().eq("id", noteId));
  if (error) {
    devError("[sync] メモの削除に失敗しました:", error.message);
    await dbAddPendingDelete("notes", noteId);
  }
}

async function persistFolder(folder: FolderData): Promise<void> {
  await dbPutFolder(folder);
  postBroadcast({ table: "folders", op: "upsert", row: folder });

  const client = getSupabaseClient();
  if (!client) {
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }
  const { userId } = useOutlineStore.getState();
  if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    await dbMarkDirty("folders", folder.id);
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }

  await dbMarkDirty("folders", folder.id);
  useOutlineStore.setState({ syncStatus: "saving" });
  queueRowForSync("folders", folder.id, folderToRow(folder, userId));
}

/**
 * フォルダ削除。ローカルは配下フォルダも含めてすべて削除し、
 * リモートはルートの1件だけ削除要求を送ればFKのon delete cascadeが配下も処理してくれる。
 */
async function persistDeleteFolderFull(folderId: string, allIdsToDeleteLocally: string[]): Promise<void> {
  await Promise.all(allIdsToDeleteLocally.map((id) => dbDeleteFolderLocal(id)));
  allIdsToDeleteLocally.forEach((id) => postBroadcast({ table: "folders", op: "delete", id }));

  const client = getSupabaseClient();
  if (!client) return;
  const { userId } = useOutlineStore.getState();
  if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    await dbAddPendingDelete("folders", folderId);
    return;
  }
  const { error } = await safeCall(() => client.from("folders").delete().eq("id", folderId));
  if (error) {
    devError("[sync] フォルダの削除に失敗しました:", error.message);
    await dbAddPendingDelete("folders", folderId);
  }
}

/** オフライン中に溜まった未同期の変更/削除をまとめてSupabaseへ送る */
export async function flushPendingSync(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const { userId } = useOutlineStore.getState();
  if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
    console.log("[Sync] 未認証またはオフラインのため、同期キューのフラッシュを見送ります");
    return;
  }

  const pendingDeletes = await dbGetPendingDeletes();
  console.log(
    "[Sync] 同期キューのフラッシュ開始: 未送信削除",
    pendingDeletes.length,
    "件"
  );
  // テーブルごとにidをまとめ、1テーブルにつき1回のdelete().in('id', ids)で送る
  // (削除件数が多くても、1件ずつ何十回もリクエストを送るループにならないようにする)
  const deletesByTable = new Map<SyncTable, { key: number; recordId: string }[]>();
  for (const pd of pendingDeletes) {
    const list = deletesByTable.get(pd.table) ?? [];
    list.push({ key: pd.key, recordId: pd.recordId });
    deletesByTable.set(pd.table, list);
  }
  for (const [table, items] of deletesByTable) {
    const { error } = await safeCall(() =>
      client
        .from(table)
        .delete()
        .in(
          "id",
          items.map((it) => it.recordId)
        )
    );
    if (!error) {
      await Promise.all(items.map((it) => dbClearPendingDelete(it.key)));
    } else {
      devError(`[sync] ${table}の削除キュー送信に失敗しました:`, error.message);
    }
  }

  const dirty = await dbGetAllDirty();
  console.log("[Sync] 同期キューのフラッシュ: 未送信の変更", dirty.length, "件");
  // テーブルごとにまとめて1回のバッチupsertで送る(1件ずつの逐次送信によるループ・
  // 過剰な通信回数を防ぎ、通信量を最小限に抑える)
  const dirtyByTable = new Map<SyncTable, string[]>();
  for (const d of dirty) {
    const list = dirtyByTable.get(d.table) ?? [];
    list.push(d.recordId);
    dirtyByTable.set(d.table, list);
  }
  // folders→notes→nodesの依存順で送る(notes.folder_id/nodes.note_idの外部キーが
  // まだリモートに存在しない参照先を先に送ってしまい、制約違反になるのを防ぐ)
  for (const table of ["folders", "notes", "nodes"] as const) {
    const ids = dirtyByTable.get(table);
    if (!ids || ids.length === 0) continue;
    let rows: Array<NodeRow | NoteRowType | FolderRowType>;
    if (table === "nodes") {
      const found = await Promise.all(ids.map((id) => dbGetNode(id)));
      rows = found.filter((n): n is OutlineNodeData => !!n).map((n) => nodeToRow(n, userId));
    } else if (table === "notes") {
      const all = await dbGetAllNotes();
      rows = ids
        .map((id) => all.find((n) => n.id === id))
        .filter((n): n is NoteData => !!n)
        .map((n) => noteToRow(n, userId));
    } else {
      const all = await dbGetAllFolders();
      rows = ids
        .map((id) => all.find((f) => f.id === id))
        .filter((f): f is FolderData => !!f)
        .map((f) => folderToRow(f, userId));
    }
    // ローカルにもう存在しない(既に削除済みの)idはdirtyのままにせずクリアする
    const foundIds = new Set(rows.map((r) => r.id));
    const missingIds = ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) await Promise.all(missingIds.map((id) => dbClearDirty(table, id)));
    if (rows.length === 0) continue;

    const failedIds = await syncRowsToTable(client, table, rows);
    const succeededIds = rows.map((r) => r.id).filter((id) => !failedIds.has(id));
    if (succeededIds.length > 0) await Promise.all(succeededIds.map((id) => dbClearDirty(table, id)));
    if (failedIds.size > 0) {
      console.log(`[Sync] ${table}のバッチ再送で失敗した行があります:`, Array.from(failedIds).join(","));
    }
  }

  if (pendingDeletes.length > 0 || dirty.length > 0) {
    markSynced();
  } else {
    console.log("[Sync] 同期キューは空でした(送信対象なし)");
  }
}

/**
 * nodesテーブルのRealtimeイベント(単一チャンネル内の1テーブル分)を処理する。
 * ユーザー全体のnodesを対象にするため、開いていないメモの行も届くが、
 * ローカルのstate.nodesを書き換えるのは現在開いているメモの分だけにする
 * (IndexedDBへの保存自体は開いていないメモの分も行い、次に開いたときに
 * 最新の内容がすぐ見えるようにする)。
 */
function handleNodeRealtimeChange(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  if (payload.eventType === "DELETE") {
    const oldId = (payload.old as { id: string }).id;
    useOutlineStore.setState((s) => {
      if (!(oldId in s.nodes)) return s;
      const next = { ...s.nodes };
      delete next[oldId];
      return { nodes: next };
    });
    void dbDeleteNode(oldId);
    return;
  }

  const incoming = nodeFromRow(payload.new as unknown as NodeRow);
  // リアルタイムで受信した内容も、DOMへinnerHTMLとして描画する前に必ず
  // サニタイズを通す(RLSで自分のデータしか流れてこないとはいえ、念のための多層防御)
  incoming.content = sanitizeHtml(incoming.content);
  markKnownRemote("nodes", [incoming.id]);
  void dbPutNode(incoming);

  const state = useOutlineStore.getState();
  if (state.currentNoteId !== incoming.noteId) return;
  const existing = state.nodes[incoming.id];
  // 自分の書き込みのエコーや古い変更で上書きしないようにする
  if (existing && existing.updatedAt >= incoming.updatedAt) return;
  useOutlineStore.setState((s) => ({ nodes: { ...s.nodes, [incoming.id]: incoming } }));
}

/**
 * foldersテーブルのRealtimeイベントを処理する。別端末(PC等)でフォルダの追加・
 * 名前変更・移動・削除が行われた瞬間、画面全体を再取得することなく、差分の
 * あった1件だけをピンポイントでローカル(Zustand/IndexedDB)へ反映する。
 * 自分自身の書き込みが返ってきたエコーはupdatedAt比較で検知してスキップする。
 */
function handleFolderRealtimeChange(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  if (payload.eventType === "DELETE") {
    const oldId = (payload.old as { id: string }).id;
    useOutlineStore.setState((s) => {
      if (!s.folders.some((f) => f.id === oldId)) return s;
      return { folders: s.folders.filter((f) => f.id !== oldId) };
    });
    void dbDeleteFolderLocal(oldId);
    console.log("[Sync] 他端末でフォルダが削除されました:", oldId);
    return;
  }

  const incoming = folderFromRow(payload.new as unknown as FolderRowType);
  const existing = useOutlineStore.getState().folders.find((f) => f.id === incoming.id);
  if (existing && existing.updatedAt >= incoming.updatedAt) return;

  markKnownRemote("folders", [incoming.id]);
  useOutlineStore.setState((s) => ({
    folders: sortFolders(
      existing ? s.folders.map((f) => (f.id === incoming.id ? incoming : f)) : [...s.folders, incoming]
    ),
  }));
  void dbPutFolder(incoming);
  console.log("[Sync] 他端末でのフォルダの変更を反映しました:", incoming.id);
}

/**
 * notesテーブルのRealtimeイベントを処理する。別端末での新規作成・タイトル変更・
 * フォルダ移動・削除を、差分のあった1件だけピンポイントでローカルへ反映する。
 * 今開いているメモ自体が他端末で削除された場合は、安全のためメモを閉じる。
 */
function handleNoteRealtimeChange(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  if (payload.eventType === "DELETE") {
    const oldId = (payload.old as { id: string }).id;
    useOutlineStore.setState((s) => {
      if (!s.notesList.some((n) => n.id === oldId)) return s;
      return {
        notesList: s.notesList.filter((n) => n.id !== oldId),
        ...(s.currentNoteId === oldId ? { currentNoteId: null, nodes: {}, activeNodeId: null } : {}),
      };
    });
    void dbDeleteNoteLocal(oldId);
    console.log("[Sync] 他端末でメモが削除されました:", oldId);
    return;
  }

  const incoming = noteFromRow(payload.new as unknown as NoteRowType);
  const existing = useOutlineStore.getState().notesList.find((n) => n.id === incoming.id);
  if (existing && existing.updatedAt >= incoming.updatedAt) return;

  markKnownRemote("notes", [incoming.id]);
  useOutlineStore.setState((s) => ({
    notesList: sortNotes(
      existing ? s.notesList.map((n) => (n.id === incoming.id ? incoming : n)) : [...s.notesList, incoming]
    ),
  }));
  void dbPutNote(incoming);
  console.log("[Sync] 他端末でのメモの変更を反映しました:", incoming.id);
}
