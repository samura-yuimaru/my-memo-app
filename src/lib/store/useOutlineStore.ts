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
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import {
  folderFromRow,
  folderToRow,
  nodeFromRow,
  nodeToRow,
  noteFromRow,
  noteToRow,
  type NodeRow,
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

/** サイドバーの複数選択で扱う項目の種類とid */
export interface SidebarItemKey {
  type: "note" | "folder";
  id: string;
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

  /** サイドバーでの複数選択(フォルダ・メモ横断)。一括削除・一括移動の対象になる */
  sidebarSelection: SidebarItemKey[];
  toggleSidebarSelection: (type: SidebarItemKey["type"], id: string) => void;
  setSidebarSelection: (items: SidebarItemKey[]) => void;
  clearSidebarSelection: () => void;
  /** 選択中のフォルダ・メモをまとめて削除する */
  deleteSidebarSelection: () => Promise<void>;
  /** 選択中のフォルダ・メモをまとめて指定フォルダ(nullはフォルダなし)へ移動する */
  moveSidebarSelectionToFolder: (folderId: string | null) => void;

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
  sidebarSelection: [],

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
    }

    const client = getSupabaseClient();
    if (client) {
      // セッションが失効(トークンリフレッシュ失敗・サインアウト等)した場合に自動で
      // 再認証を試みる、安全な再接続フロー。SupabaseのSDKがトークン更新も自動で
      // 行うが(autoRefreshToken)、それでも失われた場合の最終防御線としてここで検知する。
      client.auth.onAuthStateChange((event, session) => {
        console.log("[Sync] 認証状態が変化しました:", event);
        if (event === "SIGNED_OUT") {
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
    const merged = sortNotes(mergeByUpdatedAt(local, remoteNotes));
    await Promise.all(merged.map((n) => dbPutNote(n)));
    set({ notesList: merged });
  },

  openNote: async (noteId) => {
    unsubscribeRealtime?.();
    unsubscribeRealtime = null;
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
        const merged = mergeByUpdatedAt(Object.values(get().nodes), remoteNodes);
        await dbPutNodes(merged);
        if (get().currentNoteId === noteId) {
          set({ nodes: toMap(merged) });
          maybeAutoTitleFromFirstNode(noteId, get().nodes);
        }
      } else if (error) {
        devError("[sync] ノードの取得に失敗しました:", error.message);
      }
      // 購読を貼る直前でも、その間に別のメモへ遷移していないか再確認する
      // (遅いレスポンスが新しいメモの購読を横取りしないようにするため)
      if (get().currentNoteId === noteId) {
        unsubscribeRealtime = subscribeRealtime(noteId);
      }
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
    void persistNote(updated, { debounceMs: 500 });
  },

  deleteNote: async (noteId) => {
    const wasCurrent = get().currentNoteId === noteId;
    const nodesOfNote = wasCurrent ? Object.values(get().nodes) : await dbGetNodesByNote(noteId);
    const nodeIds = nodesOfNote.map((n) => n.id);

    set((s) => ({
      notesList: s.notesList.filter((n) => n.id !== noteId),
      ...(wasCurrent ? { currentNoteId: null, nodes: {}, activeNodeId: null } : {}),
    }));

    // 削除したメモが今開いていたメモの場合のみ、そのリアルタイム購読を解除する
    // (別のメモを削除しただけで、今開いているメモの購読を巻き込んで切らないようにする)
    if (wasCurrent) {
      unsubscribeRealtime?.();
      unsubscribeRealtime = null;
    }

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
    void persistFolder(updated, { debounceMs: 500 });
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

  toggleSidebarSelection: (type, id) => {
    set((s) => {
      const exists = s.sidebarSelection.some((it) => it.type === type && it.id === id);
      return {
        sidebarSelection: exists
          ? s.sidebarSelection.filter((it) => !(it.type === type && it.id === id))
          : [...s.sidebarSelection, { type, id }],
      };
    });
  },
  setSidebarSelection: (items) => set({ sidebarSelection: items }),
  clearSidebarSelection: () => set({ sidebarSelection: [] }),

  deleteSidebarSelection: async () => {
    const { sidebarSelection } = get();
    if (sidebarSelection.length === 0) return;
    const noteIds = sidebarSelection.filter((it) => it.type === "note").map((it) => it.id);
    // フォルダは配下を再帰的に削除するdeleteFolderに任せるため、選択に子孫フォルダが
    // 含まれていても二重処理にならないよう、他の選択フォルダの子孫であるものは除外する
    const folderIds = sidebarSelection.filter((it) => it.type === "folder").map((it) => it.id);
    const selectedFolderSet = new Set(folderIds);
    const { folders } = get();
    const isDescendantOfAnotherSelected = (id: string): boolean => {
      let current = folders.find((f) => f.id === id);
      while (current?.parentId) {
        if (selectedFolderSet.has(current.parentId)) return true;
        current = folders.find((f) => f.id === current!.parentId);
      }
      return false;
    };
    const topLevelFolderIds = folderIds.filter((id) => !isDescendantOfAnotherSelected(id));

    set({ sidebarSelection: [] });
    for (const id of noteIds) await get().deleteNote(id);
    for (const id of topLevelFolderIds) await get().deleteFolder(id);
  },

  moveSidebarSelectionToFolder: (folderId) => {
    const { sidebarSelection, folders } = get();
    if (sidebarSelection.length === 0) return;
    const selectedFolderIds = new Set(
      sidebarSelection.filter((it) => it.type === "folder").map((it) => it.id)
    );
    // 選択したフォルダ自身、またはその子孫フォルダへは移動できない(循環参照防止)
    const isSelfOrDescendantOfSelected = (id: string | null): boolean => {
      let current = folders.find((f) => f.id === id);
      while (current) {
        if (selectedFolderIds.has(current.id)) return true;
        current = folders.find((f) => f.id === current!.parentId);
      }
      return false;
    };
    if (folderId && isSelfOrDescendantOfSelected(folderId)) return;

    for (const item of sidebarSelection) {
      if (item.type === "note") get().moveNoteToFolder(item.id, folderId);
      else get().moveFolderTo(item.id, folderId);
    }
    set({ sidebarSelection: [] });
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
    void persistNode(updated, { debounceMs: 500 });
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
    void persistNode(updatedCurrent, { debounceMs: 500 });
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
    void persistNode(updatedCurrent, { debounceMs: 500 });
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
    void persistNode(updatedPrev, { debounceMs: 500 });
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

let unsubscribeRealtime: (() => void) | null = null;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
const SUPABASE_CALL_TIMEOUT_MS = 10000;

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

async function persistNode(
  node: OutlineNodeData,
  options?: { debounceMs?: number }
): Promise<void> {
  touchNoteTimestamp(node.noteId);
  await dbPutNode(node);

  const client = getSupabaseClient();
  if (!client) {
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }

  const push = async () => {
    const { userId } = useOutlineStore.getState();
    if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
      await dbMarkDirty("nodes", node.id);
      useOutlineStore.setState({ syncStatus: "offline" });
      return;
    }
    const { error } = await safeCall(() => client.from("nodes").upsert(nodeToRow(node, userId)));
    if (error) {
      devError("[sync] ノードの保存に失敗しました:", error.message);
      await dbMarkDirty("nodes", node.id);
      useOutlineStore.setState({ syncStatus: "error" });
    } else {
      await dbClearDirty("nodes", node.id);
      markSynced();
    }
  };

  if (options?.debounceMs) {
    useOutlineStore.setState({ syncStatus: "saving" });
    const key = `node:${node.id}`;
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        void push();
      }, options.debounceMs)
    );
  } else {
    useOutlineStore.setState({ syncStatus: "saving" });
    await push();
  }
}

async function persistDeleteNodes(ids: string[], noteId?: string | null): Promise<void> {
  if (ids.length === 0) return;
  if (noteId) touchNoteTimestamp(noteId);
  await dbDeleteNodes(ids);

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

async function persistNote(
  note: NoteData,
  options?: { debounceMs?: number }
): Promise<void> {
  await dbPutNote(note);

  const client = getSupabaseClient();
  if (!client) {
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }

  const push = async () => {
    const { userId } = useOutlineStore.getState();
    if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
      await dbMarkDirty("notes", note.id);
      useOutlineStore.setState({ syncStatus: "offline" });
      return;
    }
    const { error } = await safeCall(() => client.from("notes").upsert(noteToRow(note, userId)));
    if (error) {
      devError("[sync] メモの保存に失敗しました:", error.message);
      await dbMarkDirty("notes", note.id);
      useOutlineStore.setState({ syncStatus: "error" });
    } else {
      await dbClearDirty("notes", note.id);
      markSynced();
    }
  };

  if (options?.debounceMs) {
    const key = `note:${note.id}`;
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        void push();
      }, options.debounceMs)
    );
  } else {
    await push();
  }
}

async function persistDeleteNoteFull(noteId: string, nodeIds: string[]): Promise<void> {
  await dbDeleteNodes(nodeIds);
  await dbDeleteNoteLocal(noteId);

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

async function persistFolder(
  folder: FolderData,
  options?: { debounceMs?: number }
): Promise<void> {
  await dbPutFolder(folder);

  const client = getSupabaseClient();
  if (!client) {
    useOutlineStore.setState({ syncStatus: "offline" });
    return;
  }

  const push = async () => {
    const { userId } = useOutlineStore.getState();
    if (!userId || (typeof navigator !== "undefined" && !navigator.onLine)) {
      await dbMarkDirty("folders", folder.id);
      useOutlineStore.setState({ syncStatus: "offline" });
      return;
    }
    const { error } = await safeCall(() => client.from("folders").upsert(folderToRow(folder, userId)));
    if (error) {
      devError("[sync] フォルダの保存に失敗しました:", error.message);
      await dbMarkDirty("folders", folder.id);
      useOutlineStore.setState({ syncStatus: "error" });
    } else {
      await dbClearDirty("folders", folder.id);
      markSynced();
    }
  };

  if (options?.debounceMs) {
    const key = `folder:${folder.id}`;
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        void push();
      }, options.debounceMs)
    );
  } else {
    await push();
  }
}

/**
 * フォルダ削除。ローカルは配下フォルダも含めてすべて削除し、
 * リモートはルートの1件だけ削除要求を送ればFKのon delete cascadeが配下も処理してくれる。
 */
async function persistDeleteFolderFull(folderId: string, allIdsToDeleteLocally: string[]): Promise<void> {
  await Promise.all(allIdsToDeleteLocally.map((id) => dbDeleteFolderLocal(id)));

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
  for (const pd of pendingDeletes) {
    const { error } = await safeCall(() => client.from(pd.table).delete().eq("id", pd.recordId));
    if (!error) await dbClearPendingDelete(pd.key);
  }

  const dirty = await dbGetAllDirty();
  console.log("[Sync] 同期キューのフラッシュ: 未送信の変更", dirty.length, "件");
  for (const d of dirty) {
    if (d.table === "nodes") {
      const node = await dbGetNode(d.recordId);
      if (!node) {
        await dbClearDirty("nodes", d.recordId);
        continue;
      }
      const { error } = await safeCall(() => client.from("nodes").upsert(nodeToRow(node, userId)));
      if (!error) await dbClearDirty("nodes", d.recordId);
    } else if (d.table === "notes") {
      const note = (await dbGetAllNotes()).find((n) => n.id === d.recordId);
      if (!note) {
        await dbClearDirty("notes", d.recordId);
        continue;
      }
      const { error } = await safeCall(() => client.from("notes").upsert(noteToRow(note, userId)));
      if (!error) await dbClearDirty("notes", d.recordId);
    } else {
      const folder = (await dbGetAllFolders()).find((f) => f.id === d.recordId);
      if (!folder) {
        await dbClearDirty("folders", d.recordId);
        continue;
      }
      const { error } = await safeCall(() => client.from("folders").upsert(folderToRow(folder, userId)));
      if (!error) await dbClearDirty("folders", d.recordId);
    }
  }

  if (pendingDeletes.length > 0 || dirty.length > 0) {
    markSynced();
  } else {
    console.log("[Sync] 同期キューは空でした(送信対象なし)");
  }
}

/** 開いているメモの他端末での変更をリアルタイムに反映する */
function subscribeRealtime(noteId: string): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  const channel = client
    .channel(`nodes-${noteId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "nodes", filter: `note_id=eq.${noteId}` },
      (payload) => {
        const state = useOutlineStore.getState();
        if (state.currentNoteId !== noteId) return;

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

        const incoming = nodeFromRow(payload.new as NodeRow);
        // リアルタイムで受信した内容も、DOMへinnerHTMLとして描画する前に必ず
        // サニタイズを通す(RLSで自分のデータしか流れてこないとはいえ、念のための多層防御)
        incoming.content = sanitizeHtml(incoming.content);
        const existing = state.nodes[incoming.id];
        // 自分の書き込みのエコーや古い変更で上書きしないようにする
        if (existing && existing.updatedAt >= incoming.updatedAt) return;

        useOutlineStore.setState((s) => ({ nodes: { ...s.nodes, [incoming.id]: incoming } }));
        void dbPutNode(incoming);
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
