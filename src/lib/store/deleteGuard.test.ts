import { describe, it, expect, beforeEach } from "vitest";
import {
  markDeleting,
  unmarkDeleting,
  isDeleting,
  excludeDeleting,
  resetDeleteGuard,
} from "./deleteGuard";

beforeEach(() => resetDeleteGuard());

describe("markDeleting / isDeleting / unmarkDeleting", () => {
  it("登録した id は削除中とみなす", () => {
    markDeleting("nodes", ["a", "b"]);
    expect(isDeleting("nodes", "a")).toBe(true);
    expect(isDeleting("nodes", "b")).toBe(true);
    expect(isDeleting("nodes", "c")).toBe(false);
  });

  it("テーブルごとに独立している", () => {
    markDeleting("nodes", ["a"]);
    expect(isDeleting("notes", "a")).toBe(false);
  });

  it("unmarkDeleting で外れる", () => {
    markDeleting("folders", ["x", "y"]);
    unmarkDeleting("folders", ["x"]);
    expect(isDeleting("folders", "x")).toBe(false);
    expect(isDeleting("folders", "y")).toBe(true);
  });

  it("未登録テーブルへの unmark は何もしない(例外を出さない)", () => {
    expect(() => unmarkDeleting("nodes", ["z"])).not.toThrow();
  });
});

describe("excludeDeleting", () => {
  it("削除中の id を含む行を除外する", () => {
    markDeleting("notes", ["b"]);
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(excludeDeleting("notes", rows).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("削除中が無ければ元の配列をそのまま返す", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(excludeDeleting("nodes", rows)).toBe(rows);
  });
});
