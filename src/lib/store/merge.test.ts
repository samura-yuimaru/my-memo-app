import { describe, it, expect } from "vitest";
import { mergeByUpdatedAt, splitDeletedRows } from "./merge";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("mergeByUpdatedAt", () => {
  it("同じ id はより新しい updatedAt を採用する", () => {
    const local = [{ id: "a", updatedAt: T2, v: "local-new" }];
    const remote = [{ id: "a", updatedAt: T1, v: "remote-old" }];
    expect(mergeByUpdatedAt(local, remote)).toEqual([{ id: "a", updatedAt: T2, v: "local-new" }]);
  });

  it("remote の方が新しければ remote を採用する", () => {
    const local = [{ id: "a", updatedAt: T1, v: "local-old" }];
    const remote = [{ id: "a", updatedAt: T3, v: "remote-new" }];
    expect(mergeByUpdatedAt(local, remote)[0].v).toBe("remote-new");
  });

  it("local にしか無い行(未送信の新規作成)は残す", () => {
    const merged = mergeByUpdatedAt(
      [{ id: "local-only", updatedAt: T1 }],
      [{ id: "remote-only", updatedAt: T1 }]
    );
    expect(merged.map((r) => r.id).sort()).toEqual(["local-only", "remote-only"]);
  });

  it("updatedAt が同値なら local を維持する(remote で上書きしない)", () => {
    const local = [{ id: "a", updatedAt: T2, v: "local" }];
    const remote = [{ id: "a", updatedAt: T2, v: "remote" }];
    expect(mergeByUpdatedAt(local, remote)[0].v).toBe("local");
  });

  it("空配列同士なら空", () => {
    expect(mergeByUpdatedAt([], [])).toEqual([]);
  });
});

describe("splitDeletedRows", () => {
  it("deleted_at が入っている行は deletedIds へ、null/未定義は alive へ", () => {
    const rows = [
      { id: "a", deleted_at: null },
      { id: "b", deleted_at: "2026-01-05T00:00:00.000Z" },
      { id: "c" },
      { id: "d", deleted_at: undefined },
    ];
    const { alive, deletedIds } = splitDeletedRows(rows);
    expect(alive.map((r) => r.id).sort()).toEqual(["a", "c", "d"]);
    expect(deletedIds).toEqual(["b"]);
  });

  it("空配列なら両方空", () => {
    expect(splitDeletedRows([])).toEqual({ alive: [], deletedIds: [] });
  });
});
