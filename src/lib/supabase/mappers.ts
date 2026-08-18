// Supabaseの行(snake_case)とアプリ内の型(camelCase)を相互変換する。

import type { FolderData, NoteData, OutlineNodeData } from "@/types/outline";

export interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NodeRow {
  id: string;
  note_id: string;
  parent_id: string | null;
  user_id: string;
  position: number;
  content: string;
  node_type: string;
  collapsed: boolean;
  font_size: string;
  text_color: string | null;
  highlight_color: string | null;
  created_at: string;
  updated_at: string;
}

export function folderFromRow(row: FolderRow): FolderData {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function folderToRow(folder: FolderData, userId: string): FolderRow {
  return {
    id: folder.id,
    user_id: userId,
    name: folder.name,
    parent_id: folder.parentId,
    position: folder.position,
    created_at: folder.createdAt,
    updated_at: folder.updatedAt,
  };
}

export function noteFromRow(row: NoteRow): NoteData {
  return {
    id: row.id,
    title: row.title,
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function noteToRow(note: NoteData, userId: string): NoteRow {
  return {
    id: note.id,
    user_id: userId,
    title: note.title,
    folder_id: note.folderId,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  };
}

export function nodeFromRow(row: NodeRow): OutlineNodeData {
  return {
    id: row.id,
    noteId: row.note_id,
    parentId: row.parent_id,
    position: row.position,
    content: row.content,
    nodeType: row.node_type as OutlineNodeData["nodeType"],
    collapsed: row.collapsed,
    fontSize: row.font_size as OutlineNodeData["fontSize"],
    textColor: row.text_color,
    highlightColor: row.highlight_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function nodeToRow(node: OutlineNodeData, userId: string): NodeRow {
  return {
    id: node.id,
    note_id: node.noteId,
    parent_id: node.parentId,
    user_id: userId,
    position: node.position,
    content: node.content,
    node_type: node.nodeType,
    collapsed: node.collapsed,
    font_size: node.fontSize,
    text_color: node.textColor,
    highlight_color: node.highlightColor,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
  };
}
