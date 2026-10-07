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

/**
 * 選択されたノード群(selectedIds)だけから成る「部分木の森」を組み立てる。
 * 選択内の別ノードの子だったノードはその下にネストし、選択外のノードを親に持つ
 * ノードは選択の「根っこ」としてトップレベルに並べる(buildClipboardPayloadの
 * 階層復元ルールと同じ考え方)。並び順は position の再ソートではなく、
 * selectedIds に渡された順序(= 画面表示順)をそのまま保つ。
 *
 * 複数ノードコピー時、階層を保ったプレーンテキスト(buildPlainTextOutline の入力)を
 * 選択範囲だけに絞り込むために使う。これをせず buildTree の結果(メモ全体)を
 * そのまま渡すと、選択した数行のつもりが文書全体がコピーされてしまう
 * (「複数選択でコピーした内容がおかしい/改行が大量に増える」不具合の原因だった)。
 */
export function buildSelectedForest(
  nodes: OutlineNodeData[],
  selectedIds: string[]
): OutlineTreeNode[] {
  const idSet = new Set(selectedIds);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const treeNodes = new Map<string, OutlineTreeNode>();
  for (const id of selectedIds) {
    const n = byId.get(id);
    if (n) treeNodes.set(id, { ...n, children: [] });
  }

  const roots: OutlineTreeNode[] = [];
  for (const id of selectedIds) {
    const treeNode = treeNodes.get(id);
    if (!treeNode) continue;
    const parentId = treeNode.parentId;
    const parent = parentId && idSet.has(parentId) ? treeNodes.get(parentId) : undefined;
    if (parent) parent.children.push(treeNode);
    else roots.push(treeNode);
  }
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
