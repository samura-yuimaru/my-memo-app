// ============================================================
// インライン装飾(太字・文字色・蛍光ペン)対応のためのcontenteditable用ユーティリティ。
// ノードのcontentは(通常/スマートブロックの一部を除き)プレーンテキストではなく、
// ごく小さなホワイトリストのHTML断片として保存する。
// すべてDOM/Range APIを使うためブラウザ環境でのみ動作する。
// ============================================================

/** contenteditableに実際に許可するタグ(装飾以外は保存前にすべて剥がす) */
const ALLOWED_TAGS = new Set(["SPAN", "BR", "A"]);

function sanitizeNode(node: Node): void {
  // 子から先に処理する(要素を展開/削除しても兄弟の走査に影響しないようにするため)
  Array.from(node.childNodes).forEach(sanitizeNode);

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;

  if (el.tagName === "FONT") {
    // execCommand("foreColor")はブラウザによって<span style="color:...">ではなく
    // legacyな<font color="...">を生成することがある。FONTはホワイトリスト外のため
    // そのまま単純unwrapすると色ごと消えてしまう(文字色が反映されない不具合の原因だった)ので、
    // ここでSPAN + style="color:..."に変換してから残りの処理に合流させる。
    const color = el.getAttribute("color");
    const span = document.createElement("span");
    if (color) span.setAttribute("style", `color:${color}`);
    while (el.firstChild) span.appendChild(el.firstChild);
    el.replaceWith(span);
    return;
  }

  if (!ALLOWED_TAGS.has(el.tagName)) {
    // 許可されないタグ(script/div/b等)は中身だけ残して展開(unwrap)する
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    return;
  }

  if (el.tagName === "A") {
    // リンクはhttp(s)のみ許可し、他の属性はすべて安全な固定値に上書きする
    // (javascript: 等の危険なhrefを防ぐ)
    const href = el.getAttribute("href");
    Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
    if (href && /^https?:\/\//i.test(href)) {
      el.setAttribute("href", href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    } else {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
    }
    return;
  }

  // style以外の属性(onclick等)はすべて削除。styleもcolor/background-colorのみ残す
  const style = el.getAttribute("style");
  Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
  if (style) {
    const color = /(?:^|;)\s*color:\s*([^;]+)/.exec(style)?.[1]?.trim();
    const bg = /(?:^|;)\s*background-color:\s*([^;]+)/.exec(style)?.[1]?.trim();
    const cleaned = [color && `color:${color}`, bg && `background-color:${bg}`]
      .filter(Boolean)
      .join(";");
    if (cleaned) el.setAttribute("style", cleaned);
  }
}

/** 装飾以外のタグ・属性・危険なコンテンツを取り除き、許可された装飾だけを残す */
export function sanitizeHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const container = document.createElement("div");
  container.innerHTML = html;
  Array.from(container.childNodes).forEach(sanitizeNode);
  return container.innerHTML;
}

/** HTML断片からプレーンテキストを取り出す(検索・文字数判定・空判定に使う) */
export function htmlToPlainText(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, "");
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent ?? "";
}

/** 実質的に空(文字なし)かどうか。<br>だけが残っているケースも空とみなす */
export function isEmptyHtml(html: string): boolean {
  return htmlToPlainText(html).length === 0;
}

/** root配下をプレーンテキストの文字位置順に走査し、offset番目の文字が属するテキストノードを返す */
function findTextPosition(root: Node, offset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node: Node | null;
  let last: Text | null = null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const len = textNode.data.length;
    if (remaining <= len) {
      return { node: textNode, offset: remaining };
    }
    remaining -= len;
    last = textNode;
  }
  // offsetが全文字数を超える場合は末尾に丸める
  if (last) return { node: last, offset: last.data.length };
  return null;
}

/** 現在の選択(キャレット)位置を、root内のプレーンテキスト文字位置として取得する */
export function getCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return 0;
  const preRange = document.createRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

/** 現在の選択範囲の開始・終了位置を、root内のプレーンテキスト文字位置として取得する */
export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const preStart = document.createRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = document.createRange();
  preEnd.selectNodeContents(root);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;

  return start <= end ? { start, end } : { start: end, end: start };
}

/** root内のプレーンテキスト文字位置offsetへキャレットを移動する */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const pos = findTextPosition(root, Math.max(0, offset));
  if (pos) {
    range.setStart(pos.node, pos.offset);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * HTML断片をプレーンテキストの文字位置offsetで前半/後半に分割する。
 * 装飾(太字・色)がoffsetをまたいでいる場合も、Range.cloneContentsにより
 * 前半・後半それぞれで装飾タグが正しく複製される。
 */
export function splitHtmlAtOffset(html: string, offset: number): [string, string] {
  if (typeof document === "undefined") {
    return [html.slice(0, offset), html.slice(offset)];
  }
  const container = document.createElement("div");
  container.innerHTML = html;

  const plainLength = container.textContent?.length ?? 0;
  if (offset <= 0) return ["", container.innerHTML];
  if (offset >= plainLength) return [container.innerHTML, ""];

  const pos = findTextPosition(container, offset);
  if (!pos) return [container.innerHTML, ""];

  const beforeRange = document.createRange();
  beforeRange.setStart(container, 0);
  beforeRange.setEnd(pos.node, pos.offset);
  const beforeDiv = document.createElement("div");
  beforeDiv.appendChild(beforeRange.cloneContents());

  const afterRange = document.createRange();
  afterRange.setStart(pos.node, pos.offset);
  afterRange.setEndAfter(container.lastChild ?? container);
  const afterDiv = document.createElement("div");
  afterDiv.appendChild(afterRange.cloneContents());

  return [beforeDiv.innerHTML, afterDiv.innerHTML];
}

/** そのroot内で現在何か範囲選択(コラプスしていない選択)があるかどうか */
export function hasActiveSelectionWithin(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  return root.contains(range.startContainer) && root.contains(range.endContainer);
}

/** プレーンテキストをHTMLとして安全な文字列にエスケープする(貼り付け・分割時に使う) */
export function escapeHtml(text: string): string {
  if (typeof document === "undefined") {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'　]+/g;

/** テキスト中のURLを自動でクリック可能なリンクに変える(既存のリンクの中は対象外) */
export function linkifyHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const container = document.createElement("div");
  container.innerHTML = html;
  linkifyWithin(container);
  return container.innerHTML;
}

function linkifyWithin(node: Node): void {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      URL_PATTERN.lastIndex = 0;
      if (!URL_PATTERN.test(text)) return;
      URL_PATTERN.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = URL_PATTERN.exec(text))) {
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const a = document.createElement("a");
        a.href = match[0];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = match[0];
        frag.appendChild(a);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      node.replaceChild(frag, child);
    } else if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName !== "A") {
      linkifyWithin(child);
    }
  });
}

/**
 * 任意のCSS色表現(varやCSS変数を含む)を、ブラウザが計算した"rgb(r, g, b)"形式に変換する。
 * document.queryCommandValueが返す色と比較するために使う(文字色ピッカーの選択状態同期用)。
 */
export function resolveCssColor(value: string): string {
  if (typeof document === "undefined") return value;
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return resolved;
}
