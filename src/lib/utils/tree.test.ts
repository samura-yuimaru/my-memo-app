import { describe, it, expect } from "vitest";
import {
  buildTree,
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
