// ============================================================
// 全メモ横断のリアルタイム検索。IndexedDBを直接読み、
// マッチ箇所を前後の文脈つきスニペットとして返す。
// ============================================================
import { dbGetAllNodes, dbGetAllNotes } from "@/lib/db/indexeddb";
import { htmlToPlainText } from "@/lib/utils/richText";

export interface SearchResult {
  noteId: string;
  noteTitle: string;
  /** nullの場合はメモタイトル自体がマッチしたことを表す */
  nodeId: string | null;
  before: string;
  match: string;
  after: string;
}

const SNIPPET_RADIUS = 22;
const MAX_RESULTS = 30;

function buildSnippet(
  text: string,
  index: number,
  queryLen: number
): { before: string; match: string; after: string } {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + queryLen + SNIPPET_RADIUS);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, index),
    match: text.slice(index, index + queryLen),
    after: text.slice(index + queryLen, end) + (end < text.length ? "…" : ""),
  };
}

/** 全メモのタイトル・本文からqueryに一致する箇所を横断検索する */
export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [notes, nodes] = await Promise.all([dbGetAllNotes(), dbGetAllNodes()]);
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const results: SearchResult[] = [];

  for (const note of notes) {
    const idx = note.title.toLowerCase().indexOf(q);
    if (idx !== -1) {
      results.push({
        noteId: note.id,
        noteTitle: note.title || "無題のメモ",
        nodeId: null,
        ...buildSnippet(note.title, idx, q.length),
      });
    }
  }

  for (const node of nodes) {
    const plain = htmlToPlainText(node.content);
    const idx = plain.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    const note = noteById.get(node.noteId);
    if (!note) continue;
    results.push({
      noteId: node.noteId,
      noteTitle: note.title || "無題のメモ",
      nodeId: node.id,
      ...buildSnippet(plain, idx, q.length),
    });
    if (results.length >= MAX_RESULTS) break;
  }

  return results.slice(0, MAX_RESULTS);
}
