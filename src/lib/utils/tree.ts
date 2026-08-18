import type { OutlineNodeData, OutlineTreeNode } from "@/types/outline";
import { htmlToPlainText } from "@/lib/utils/richText";

/** 兄弟間の順序を計算する際に使う基準間隔 */
const POSITION_GAP = 1000;

/**
 * フラットなノード配列から表示用のツリー構造を組み立てる。
 * parentIdが存在しない/見つからないノードはルート扱いにする。
 */
export function buildTree(nodes: OutlineNodeData[]): OutlineTreeNode[] {
  const map = new Map<string, OutlineTreeNode>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));

  const roots: OutlineTreeNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortRec = (list: OutlineTreeNode[]) => {
    list.sort((a, b) => a.position - b.position);
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);

  return roots;
}

/** 配下(子孫)の総ノード数を数える。折りたたみバッジ表示に使う */
export function countDescendants(node: OutlineTreeNode): number {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child);
  }
  return count;
}

/** 指定した親の直下の兄弟ノードを順序どおりに取得する */
export function getSiblings(
  nodes: OutlineNodeData[],
  parentId: string | null
): OutlineNodeData[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.position - b.position);
}

/** prevとnextの中間のposition値を計算する(中点挿入方式) */
export function midpointPosition(
  prev: number | undefined,
  next: number | undefined
): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return (next as number) - POSITION_GAP;
  if (next === undefined) return prev + POSITION_GAP;
  return (prev + next) / 2;
}

/**
 * prevとnextの間に、順序を保ったままcount個の新しいposition値を均等割りで生成する。
 * 複数ノードの一括移動(範囲選択したままのドラッグ&ドロップ、一括インデント等)で、
 * 選択順を保持しつつまとめて挿入する際に使う。
 */
export function sequentialPositions(
  prev: number | undefined,
  next: number | undefined,
  count: number
): number[] {
  if (count <= 0) return [];
  const start = prev ?? (next !== undefined ? next - POSITION_GAP * (count + 1) : 0);
  const end = next ?? start + POSITION_GAP * (count + 1);
  const step = (end - start) / (count + 1);
  return Array.from({ length: count }, (_, i) => start + step * (i + 1));
}

/** 折りたたみを考慮して、現在画面に見えている順にノードを一列に並べる */
export function flattenVisible(tree: OutlineTreeNode[]): OutlineTreeNode[] {
  const out: OutlineTreeNode[] = [];
  const walk = (list: OutlineTreeNode[]) => {
    for (const node of list) {
      out.push(node);
      if (!node.collapsed && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(tree);
  return out;
}

/** targetIdがancestorIdの子孫(またはancestorId自身)かどうかを判定する */
export function isSelfOrDescendant(
  nodes: OutlineNodeData[],
  ancestorId: string,
  targetId: string
): boolean {
  if (ancestorId === targetId) return true;
  let current = nodes.find((n) => n.id === targetId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = nodes.find((n) => n.id === current!.parentId);
  }
  return false;
}

/** 指定ノードの直前の兄弟を返す(先頭ならundefined) */
export function getPrevSibling(
  nodes: OutlineNodeData[],
  node: OutlineNodeData
): OutlineNodeData | undefined {
  const siblings = getSiblings(nodes, node.parentId);
  const idx = siblings.findIndex((s) => s.id === node.id);
  return idx > 0 ? siblings[idx - 1] : undefined;
}

/** 指定ノードの直後の兄弟を返す(末尾ならundefined) */
export function getNextSibling(
  nodes: OutlineNodeData[],
  node: OutlineNodeData
): OutlineNodeData | undefined {
  const siblings = getSiblings(nodes, node.parentId);
  const idx = siblings.findIndex((s) => s.id === node.id);
  return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : undefined;
}

/** メモ全体(または選択範囲)を、階層をインデントで表したプレーンテキストにする(コピー用) */
export function buildPlainTextOutline(nodes: OutlineTreeNode[], depth = 0): string {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push("  ".repeat(depth) + htmlToPlainText(node.content));
    if (node.children.length > 0) {
      lines.push(buildPlainTextOutline(node.children, depth + 1));
    }
  }
  return lines.join("\n");
}
