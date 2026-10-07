import { describe, it, expect } from "vitest";
import { splitPastedLines } from "./richText";

describe("splitPastedLines", () => {
  it("1行ならそのまま1要素", () => {
    expect(splitPastedLines("abc")).toEqual(["abc"]);
  });

  it("CRLF / CR / LF を同じ改行として扱う", () => {
    expect(splitPastedLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("末尾の改行は取り除く(余計な空ノードを作らない)", () => {
    expect(splitPastedLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitPastedLines("a\r\nb\r\n\r\n")).toEqual(["a", "b"]);
    expect(splitPastedLines("abc\n")).toEqual(["abc"]);
  });

  it("途中の空行は元の構造として残す", () => {
    expect(splitPastedLines("a\n\nb")).toEqual(["a", "", "b"]);
  });

  it("先頭の空白は変更しない", () => {
    expect(splitPastedLines("a\n  b")).toEqual(["a", "  b"]);
  });

  it("改行だけの入力は空の1要素になる", () => {
    expect(splitPastedLines("\n")).toEqual([""]);
  });
});
