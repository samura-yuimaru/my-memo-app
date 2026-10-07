import { describe, it, expect } from "vitest";
import {
  buildTree,
  buildSelectedForest,
  buildPlainTextOutline,
  countDescendants,
  getSiblings,
  getPrevSibling,
  getNextSibling,
  midpointPosition,
  sequentialPositions,
  flattenVisible,
  isSelfOrDescendant,
} from "./tree";
import type { OutlineNodeData } from "@/types/outline";

function node(partial: Partial<OutlineNodeData> & { id: string }): OutlineNodeData {
  return {
    noteId: "note-1",
    parentId: null,
    position: 0,
    content: "",
    nodeType: "normal",
    collapsed: false,
    fontSize: "md",
    textColor: null,
    highlightColor: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("buildTree", () => {
  it("親子関係を組み立て、position順に並べる", () => {
    const nodes = [
      node({ id: "b", position: 20 }),
      node({ id: "a", position: 10 }),
      node({ id: "a2", parentId: "a", position: 2 }),
      node({ id: "a1", parentId: "a", position: 1 }),
    ];
    const tree = buildTree(nodes);
    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["a1", "a2"]);
  });

  it("親が見つからないノードはルート扱いにする", () => {
    const tree = buildTree([node({ id: "x", parentId: "missing" })]);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });

  it("元の配列を変更しない(children を足したコピーを返す)", () => {
    const src = [node({ id: "a" })];
    buildTree(src);
    expect("children" in src[0]).toBe(false);
  });
});

describe("countDescendants", () => {
  it("子孫の総数を数える", () => {
    const tree = buildTree([
      node({ id: "a" }),
      node({ id: "a1", parentId: "a" }),
      node({ id: "a2", parentId: "a" }),
      node({ id: "a1x", parentId: "a1" }),
    ]);
    expect(countDescendants(tree[0])).toBe(3);
  });
});

describe("getSiblings / getPrevSibling / getNextSibling", () => {
  const nodes = [
    node({ id: "n2", parentId: "p", position: 20 }),
    node({ id: "n1", parentId: "p", position: 10 }),
    node({ id: "n3", parentId: "p", position: 30 }),
    node({ id: "other", parentId: "q", position: 10 }),
  ];

  it("同じ親の兄弟だけを position 順で返す", () => {
    expect(getSiblings(nodes, "p").map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("直前/直後の兄弟を返す。端は undefined", () => {
    const n2 = nodes.find((n) => n.id === "n2")!;
    expect(getPrevSibling(nodes, n2)?.id).toBe("n1");
    expect(getNextSibling(nodes, n2)?.id).toBe("n3");
    const n1 = nodes.find((n) => n.id === "n1")!;
    expect(getPrevSibling(nodes, n1)).toBeUndefined();
    const n3 = nodes.find((n) => n.id === "n3")!;
    expect(getNextSibling(nodes, n3)).toBeUndefined();
  });
});

describe("midpointPosition", () => {
  it("両端が undefined なら 0", () => {
    expect(midpointPosition(undefined, undefined)).toBe(0);
  });
  it("片側だけ与えられたら GAP ぶんずらす", () => {
    expect(midpointPosition(100, undefined)).toBe(1100);
    expect(midpointPosition(undefined, 100)).toBe(-900);
  });
  it("両側あれば中点", () => {
    expect(midpointPosition(0, 100)).toBe(50);
  });
});

describe("sequentialPositions", () => {
  it("count 個の position を昇順・均等割りで返す", () => {
    const out = sequentialPositions(0, 100, 3);
    expect(out).toHaveLength(3);
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(out[0]).toBeGreaterThan(0);
    expect(out[2]).toBeLessThan(100);
  });
  it("count が 0 以下なら空配列", () => {
    expect(sequentialPositions(0, 100, 0)).toEqual([]);
  });
});

describe("flattenVisible", () => {
  it("折りたたまれた枝の子は含めない", () => {
    const tree = buildTree([
      node({ id: "a", position: 10 }),
      node({ id: "a1", parentId: "a" }),
      node({ id: "b", position: 20, collapsed: true }),
      node({ id: "b1", parentId: "b" }),
    ]);
    expect(flattenVisible(tree).map((n) => n.id)).toEqual(["a", "a1", "b"]);
  });
});

describe("isSelfOrDescendant", () => {
  const nodes = [
    node({ id: "a" }),
    node({ id: "a1", parentId: "a" }),
    node({ id: "a1x", parentId: "a1" }),
    node({ id: "b" }),
  ];
  it("自分自身は true", () => {
    expect(isSelfOrDescendant(nodes, "a", "a")).toBe(true);
  });
  it("孫は true", () => {
    expect(isSelfOrDescendant(nodes, "a", "a1x")).toBe(true);
  });
  it("無関係なノードは false", () => {
    expect(isSelfOrDescendant(nodes, "a", "b")).toBe(false);
  });
});

describe("buildSelectedForest + buildPlainTextOutline(複数選択コピーの中核)", () => {
  // 親子5件のメモの中から一部だけを選択するシナリオ(行A/行B/行C の3行構成)
  const nodes = [
    node({ id: "root", position: 10, content: "見出し" }),
    node({ id: "a", parentId: "root", position: 10, content: "行A" }),
    node({ id: "b", parentId: "root", position: 20, content: "行B" }),
    node({ id: "b1", parentId: "b", position: 10, content: "行B子" }),
    node({ id: "c", parentId: "root", position: 30, content: "行C" }),
  ];

  it("選択した行だけを抜き出す(メモ全体を巻き込まない)", () => {
    const forest = buildSelectedForest(nodes, ["a", "b"]);
    const ids = (list: typeof forest): string[] => list.flatMap((n) => [n.id, ...ids(n.children)]);
    expect(ids(forest).sort()).toEqual(["a", "b"]);
  });

  it("選択内の親子関係は保ったまま、選択外の祖先(root)は含めない", () => {
    const forest = buildSelectedForest(nodes, ["b", "b1"]);
    expect(forest).toHaveLength(1);
    expect(forest[0].id).toBe("b");
    expect(forest[0].children.map((c) => c.id)).toEqual(["b1"]);
  });

  it("選択IDの渡された順序(画面表示順)を保つ", () => {
    const forest = buildSelectedForest(nodes, ["c", "a"]);
    expect(forest.map((n) => n.id)).toEqual(["c", "a"]);
  });

  it("プレーンテキストは選択した行数ぶんの改行だけになる(メモ全体の行数にならない)", () => {
    const text = buildPlainTextOutline(buildSelectedForest(nodes, ["a", "b"]));
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("行A");
    expect(text).toContain("行B");
    expect(text).not.toContain("行C");
    expect(text).not.toContain("見出し");
  });

  it("選択内の子はインデントされる", () => {
    const text = buildPlainTextOutline(buildSelectedForest(nodes, ["b", "b1"]));
    const lines = text.split("\n");
    expect(lines[0]).toBe("行B");
    expect(lines[1]).toBe("  行B子");
  });

  it("全選択(select all)相当なら従来どおりメモ全体になる", () => {
    const allIds = nodes.map((n) => n.id);
    const text = buildPlainTextOutline(buildSelectedForest(nodes, allIds));
    expect(text.split("\n")).toHaveLength(nodes.length);
  });
});
