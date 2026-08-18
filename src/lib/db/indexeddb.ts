// ============================================================
// ローカルファースト保存層(IndexedDB)
// Supabase未接続、またはオフライン時はこの層だけでアプリが完結する。
// ============================================================
import type { FolderData, NoteData, OutlineNodeData } from "@/types/outline";

const DB_NAME = "memo-outliner-db";
const DB_VERSION = 2;

/** 同期対象のテーブル名(dirty管理・削除キューで共通に使う) */
export type SyncTable = "notes" | "nodes" | "folders";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDBはブラウザでのみ利用できます"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("notes")) {
        db.createObjectStore("notes", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("nodes")) {
        const store = db.createObjectStore("nodes", { keyPath: "id" });
        store.createIndex("noteId", "noteId", { unique: false });
        store.createIndex("parentId", "parentId", { unique: false });
      }
      if (!db.objectStoreNames.contains("folders")) {
        db.createObjectStore("folders", { keyPath: "id" });
      }
      // Supabaseへ未送信の削除操作を記録しておくキュー
      if (!db.objectStoreNames.contains("pendingDeletes")) {
        db.createObjectStore("pendingDeletes", {
          keyPath: "key",
          autoIncrement: true,
        });
      }
      // Supabaseへ未送信の変更があるレコードのidを記録
      if (!db.objectStoreNames.contains("dirty")) {
        db.createObjectStore("dirty", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result: T | void;
    try {
      const req = fn(store);
      if (req) {
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => reject(req.error);
      }
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- notes ----------------

export async function dbPutNote(note: NoteData): Promise<void> {
  await withStore("notes", "readwrite", (store) => store.put(note));
}

export async function dbGetAllNotes(): Promise<NoteData[]> {
  const db = await openDb();
  const tx = db.transaction("notes", "readonly");
  const result = await runRequest(tx.objectStore("notes").getAll());
  return (result as NoteData[]).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export async function dbGetNote(id: string): Promise<NoteData | undefined> {
  const db = await openDb();
  const tx = db.transaction("notes", "readonly");
  return runRequest(tx.objectStore("notes").get(id));
}

export async function dbDeleteNote(id: string): Promise<void> {
  await withStore("notes", "readwrite", (store) => store.delete(id));
}

// ---------------- folders ----------------

export async function dbPutFolder(folder: FolderData): Promise<void> {
  await withStore("folders", "readwrite", (store) => store.put(folder));
}

export async function dbGetAllFolders(): Promise<FolderData[]> {
  const db = await openDb();
  const tx = db.transaction("folders", "readonly");
  const result = await runRequest(tx.objectStore("folders").getAll());
  return result as FolderData[];
}

export async function dbDeleteFolder(id: string): Promise<void> {
  await withStore("folders", "readwrite", (store) => store.delete(id));
}

// ---------------- nodes ----------------

export async function dbPutNode(node: OutlineNodeData): Promise<void> {
  await withStore("nodes", "readwrite", (store) => store.put(node));
}

/** 全メモを横断した検索のため、開いていないメモの分も含めて全ノードを取得する */
export async function dbGetAllNodes(): Promise<OutlineNodeData[]> {
  const db = await openDb();
  const tx = db.transaction("nodes", "readonly");
  const result = await runRequest(tx.objectStore("nodes").getAll());
  return result as OutlineNodeData[];
}

export async function dbPutNodes(nodes: OutlineNodeData[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    nodes.forEach((n) => store.put(n));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGetNode(id: string): Promise<OutlineNodeData | undefined> {
  const db = await openDb();
  const tx = db.transaction("nodes", "readonly");
  return runRequest(tx.objectStore("nodes").get(id));
}

export async function dbGetNodesByNote(
  noteId: string
): Promise<OutlineNodeData[]> {
  const db = await openDb();
  const tx = db.transaction("nodes", "readonly");
  const index = tx.objectStore("nodes").index("noteId");
  const result = await runRequest(index.getAll(noteId));
  return result as OutlineNodeData[];
}

export async function dbDeleteNode(id: string): Promise<void> {
  await withStore("nodes", "readwrite", (store) => store.delete(id));
}

export async function dbDeleteNodes(ids: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- dirty (未同期) 管理 ----------------

export async function dbMarkDirty(table: SyncTable, id: string): Promise<void> {
  await withStore("dirty", "readwrite", (store) =>
    store.put({ id: `${table}:${id}`, table, recordId: id })
  );
}

export async function dbClearDirty(table: SyncTable, id: string): Promise<void> {
  await withStore("dirty", "readwrite", (store) =>
    store.delete(`${table}:${id}`)
  );
}

export async function dbGetAllDirty(): Promise<
  { table: SyncTable; recordId: string }[]
> {
  const db = await openDb();
  const tx = db.transaction("dirty", "readonly");
  const result = await runRequest(tx.objectStore("dirty").getAll());
  return result as { table: SyncTable; recordId: string }[];
}

// ---------------- pendingDeletes (未同期の削除) ----------------

export async function dbAddPendingDelete(table: SyncTable, id: string): Promise<void> {
  await withStore("pendingDeletes", "readwrite", (store) =>
    store.add({ table, recordId: id })
  );
}

export async function dbGetPendingDeletes(): Promise<
  { key: number; table: SyncTable; recordId: string }[]
> {
  const db = await openDb();
  const tx = db.transaction("pendingDeletes", "readonly");
  const result = await runRequest(tx.objectStore("pendingDeletes").getAll());
  return result as { key: number; table: SyncTable; recordId: string }[];
}

export async function dbClearPendingDelete(key: number): Promise<void> {
  await withStore("pendingDeletes", "readwrite", (store) => store.delete(key));
}

// ---------------- meta (キー・バリュー) ----------------

export async function dbSetMeta(key: string, value: unknown): Promise<void> {
  await withStore("meta", "readwrite", (store) => store.put({ key, value }));
}

export async function dbGetMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction("meta", "readonly");
  const result = await runRequest(tx.objectStore("meta").get(key));
  return (result as { key: string; value: T } | undefined)?.value;
}
