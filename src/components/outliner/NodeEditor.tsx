"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { getAutoFontSizeClass, TEXT_COLOR_PALETTE } from "@/lib/nodeStyles";
import { SMART_BLOCKS, getSmartBlockDef } from "@/lib/smartBlocks";
import {
  escapeHtml,
  getSelectionOffsets,
  hasActiveSelectionWithin,
  htmlToPlainText,
  isEmptyHtml,
  linkifyHtml,
  resolveCssColor,
  sanitizeHtml,
  setCaretOffset,
  splitHtmlAtOffset,
} from "@/lib/utils/richText";
import { SELECTED_TEXT_HEX } from "@/lib/uiClasses";
import type { ActiveColors } from "./NodeStylePopover";
import type { OutlineNodeData } from "@/types/outline";

interface NodeEditorProps {
  node: OutlineNodeData;
  hasChildren: boolean;
  depth: number;
  /** 自身またはいずれかの祖先がスマート構造化ブロックかどうか(フォントサイズを「小」に固定するため) */
  insideSmartBlock: boolean;
  /** 行が範囲選択(網掛け)中かどうか。trueの間は、ユーザーが選んだ文字色に関わらず
   *  選択ハイライトの上で確実に読める濃い色を強制表示する */
  selected?: boolean;
}

/** 行内装飾ボタン(文字色)から呼び出すための命令的ハンドル */
export interface NodeEditorHandle {
  applyTextColor: (color: string | null) => void;
  hasSelection: () => boolean;
  /** 現在の選択範囲に実際に適用されている色を、パレットの値として返す(未選択ならnull) */
  getActiveColors: () => ActiveColors | null;
}

/** キャレット直前の3文字が"..."なら三点リーダー"…"へ自動置換する(入力補完) */
function maybeReplaceEllipsis(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const container = range.startContainer;
  if (container.nodeType !== Node.TEXT_NODE) return;
  const textNode = container as Text;
  const offset = range.startOffset;
  if (offset < 3) return;
  if ((textNode.data ?? "").slice(offset - 3, offset) !== "...") return;
  textNode.replaceData(offset - 3, 3, "…");
  const newRange = document.createRange();
  newRange.setStart(textNode, offset - 2);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

/**
 * 1ノード分の入力欄。contentEditableで、選択したテキストだけを文字色に装飾できる
 * (node.contentは装飾用の小さなホワイトリストHTML断片として保存する)。
 * Enter/Backspace/Tab/矢印キー等アウトライナーの主要キー操作もすべてここで処理する。
 */
export const NodeEditor = forwardRef<NodeEditorHandle, NodeEditorProps>(function NodeEditor(
  { node, hasChildren, depth, insideSmartBlock, selected = false },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isFocusedRef = useRef(false);
  // 直近でDOMに反映済みのHTML(自分自身のonInputによる変化を、外部同期と区別するため)
  const lastKnownContentRef = useRef<string>(node.content);
  const lastSyncedHistoryVersionRef = useRef<number>(0);

  const updateNodeContent = useOutlineStore((s) => s.updateNodeContent);
  const splitNode = useOutlineStore((s) => s.splitNode);
  const pasteLines = useOutlineStore((s) => s.pasteLines);
  const mergeWithPrevious = useOutlineStore((s) => s.mergeWithPrevious);
  const deleteNode = useOutlineStore((s) => s.deleteNode);
  const indentNode = useOutlineStore((s) => s.indentNode);
  const outdentNode = useOutlineStore((s) => s.outdentNode);
  const moveNodeUp = useOutlineStore((s) => s.moveNodeUp);
  const moveNodeDown = useOutlineStore((s) => s.moveNodeDown);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const insertSmartBlock = useOutlineStore((s) => s.insertSmartBlock);
  const setActiveNodeId = useOutlineStore((s) => s.setActiveNodeId);
  const clearFocusRequest = useOutlineStore((s) => s.clearFocusRequest);
  const focusPrevVisible = useOutlineStore((s) => s.focusPrevVisible);
  const focusNextVisible = useOutlineStore((s) => s.focusNextVisible);
  const selectAllNodes = useOutlineStore((s) => s.selectAllNodes);
  const clearNodeSelection = useOutlineStore((s) => s.clearNodeSelection);
  const hasMultiSelection = useOutlineStore((s) => s.selectedNodeIds.length > 0);
  const historyVersion = useOutlineStore((s) => s.historyVersion);
  const focusRequest = useOutlineStore((s) =>
    s.focusRequest?.id === node.id ? s.focusRequest : null
  );

  // マウント時に一度だけ初期HTMLを流し込む(以降はReactの再描画で書き換えない)
  useEffect(() => {
    const el = editorRef.current;
    if (el) el.innerHTML = node.content;
    lastSyncedHistoryVersionRef.current = historyVersion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 他端末からのリアルタイム同期など、自分のonInput以外の理由でcontentが変わった場合に
  // DOMへ反映する。編集中(フォーカス中)は通常上書きしないが、Undo/Redoによる変更(historyVersionの
  // 増加)だけは例外的に、フォーカス中でも強制的にDOMを巻き戻す(Undoの結果が画面に反映されないと
  // 意味がないため)。
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const forced = historyVersion !== lastSyncedHistoryVersionRef.current;
    lastSyncedHistoryVersionRef.current = historyVersion;
    if (node.content === lastKnownContentRef.current && !forced) return;
    lastKnownContentRef.current = node.content;
    if (isFocusedRef.current && !forced) return;
    el.innerHTML = node.content;
    if (forced && isFocusedRef.current) {
      setCaretOffset(el, htmlToPlainText(el.innerHTML).length);
    }
  }, [node.content, historyVersion]);

  // ストアからのフォーカス要求を反映(新規作成/分割/削除後のカーソル移動)
  useEffect(() => {
    if (!focusRequest) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const plainLength = htmlToPlainText(el.innerHTML).length;
    const pos =
      focusRequest.caret === "start" ? 0 : focusRequest.caret === "end" ? plainLength : focusRequest.caret;
    setCaretOffset(el, Math.max(0, Math.min(pos, plainLength)));
    clearFocusRequest();
  }, [focusRequest, clearFocusRequest]);

  function commitFromDom() {
    const el = editorRef.current;
    if (!el) return;
    let html = el.innerHTML;
    if (isEmptyHtml(html)) {
      html = "";
      if (el.innerHTML !== "") el.innerHTML = "";
    }
    lastKnownContentRef.current = html;
    updateNodeContent(node.id, html);
  }

  useImperativeHandle(ref, () => ({
    applyTextColor: (color) => {
      const el = editorRef.current;
      if (!el || !hasActiveSelectionWithin(el)) return;
      el.focus();
      // styleWithCSSを有効にしないと、ブラウザによってはforeColorが<span style="color:...">では
      // なく<font color="...">を生成することがあり、装飾のホワイトリストサニタイズで
      // 意図せず色だけ消えてしまう(保存はされるが再読み込み後に反映されないバグの原因だった)。
      document.execCommand("styleWithCSS", false, "true");
      // execCommandはCSS変数(var(--x))をそのまま渡すと解決できず透明色になってしまうため、
      // 現在のテーマでの実際の色に解決してから渡す
      document.execCommand("foreColor", false, color ? resolveCssColor(color) : "inherit");
      commitFromDom();
    },
    hasSelection: () => {
      const el = editorRef.current;
      return !!el && hasActiveSelectionWithin(el);
    },
    getActiveColors: () => {
      const el = editorRef.current;
      if (!el || !hasActiveSelectionWithin(el)) return null;
      const rawText = document.queryCommandValue("foreColor");
      const matchColor = (raw: string, palette: typeof TEXT_COLOR_PALETTE) => {
        if (!raw) return null;
        const found = palette.find((c) => c.value !== null && resolveCssColor(c.value) === raw);
        return found ? found.value : null;
      };
      return { textColor: matchColor(rawText, TEXT_COLOR_PALETTE) };
    },
  }));

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = editorRef.current;
    if (!el) return;
    const isMod = e.metaKey || e.ctrlKey;

    // 選択範囲をメモ全体に広げた状態でのEscapeは、その選択を解除する
    if (e.key === "Escape" && hasMultiSelection) {
      e.preventDefault();
      clearNodeSelection();
      return;
    }

    // 全選択(Notion互換の2段階): 1回目はブラウザの既定動作(このノード内を全選択)に任せ、
    // 既にノード全体が選択された状態でもう一度押すとメモ全体を選択状態にする
    if (isMod && e.key.toLowerCase() === "a") {
      const offsets = getSelectionOffsets(el);
      const plainLength = htmlToPlainText(el.innerHTML).length;
      const alreadyFullySelected =
        offsets && plainLength > 0 && offsets.start === 0 && offsets.end === plainLength;
      if (alreadyFullySelected) {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        selectAllNodes();
      }
      return;
    }

    // スマートブロック挿入: Cmd/Ctrl + Shift + 1〜5
    if (isMod && e.shiftKey && /^[1-5]$/.test(e.key)) {
      e.preventDefault();
      const block = SMART_BLOCKS.find((b) => b.shortcutKey === e.key);
      if (block) insertSmartBlock(node.id, block.type);
      return;
    }

    // 折りたたみ切り替え: Cmd/Ctrl + Enter (iPad外付けキーボード対応)
    if (isMod && e.key === "Enter") {
      e.preventDefault();
      toggleCollapse(node.id);
      return;
    }

    // 兄弟内での並べ替え: Alt + ↑ / ↓
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      moveNodeUp(node.id);
      return;
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      moveNodeDown(node.id);
      return;
    }

    // インデント / インデント解除(スマート構造化ブロックの内部でも同じように自由に使える)
    if (e.key === "Tab") {
      e.preventDefault();
      // インデントの上げ下げは親を跨ぐ移動になりDOMが再マウントされるため、
      // 元のキャレット位置を渡して再フォーカス時に復元する
      const caretPos = getSelectionOffsets(el)?.start ?? 0;
      if (e.shiftKey) outdentNode(node.id, caretPos);
      else indentNode(node.id, caretPos);
      return;
    }

    // ノード内で改行(装飾の途中でも<br>として挿入する)
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertLineBreak");
      commitFromDom();
      return;
    }

    // 新規ノード追加(カーソル位置で分割。子の有無に関わらず常に同じ階層の兄弟として追加される)
    if (e.key === "Enter") {
      e.preventDefault();
      const offsets = getSelectionOffsets(el);
      if (!offsets) return;
      if (offsets.start !== offsets.end) {
        document.execCommand("delete");
      }
      const currentHtml = el.innerHTML;
      const splitAt = getSelectionOffsets(el)?.start ?? offsets.start;
      // 自分自身のDOMも即座に前半だけへ更新しておく
      // (フォーカスは直後に新ノードへ移るため、外部同期の"編集中は上書きしない"ガードに
      //  阻まれて前半だけへ縮まないままになるのを避けるため)
      const [before] = splitHtmlAtOffset(currentHtml, splitAt);
      el.innerHTML = before;
      lastKnownContentRef.current = before;
      splitNode(node.id, splitAt);
      return;
    }

    // Backspace: 空ノードの削除 / 全選択状態からの削除 / 前のノードへの結合
    if (e.key === "Backspace") {
      const offsets = getSelectionOffsets(el);
      if (!offsets) return;
      const plainLength = htmlToPlainText(el.innerHTML).length;
      const fullySelected = plainLength > 0 && offsets.start === 0 && offsets.end === plainLength;
      const collapsedAtStart = offsets.start === 0 && offsets.end === 0;

      if (fullySelected || (collapsedAtStart && plainLength === 0)) {
        if (hasChildren) return; // 子を持つ場合は誤操作防止のため何もしない
        e.preventDefault();
        deleteNode(node.id);
        return;
      }

      if (collapsedAtStart) {
        if (hasChildren) return;
        e.preventDefault();
        mergeWithPrevious(node.id);
        return;
      }
      return;
    }

    // 行の境界でのカーソル移動: 前後のノードへ
    if (e.key === "ArrowUp" && !e.shiftKey && !isMod && !e.altKey) {
      const offsets = getSelectionOffsets(el);
      if (offsets && offsets.start === 0 && offsets.end === 0) {
        e.preventDefault();
        focusPrevVisible(node.id);
      }
      return;
    }
    if (e.key === "ArrowDown" && !e.shiftKey && !isMod && !e.altKey) {
      const offsets = getSelectionOffsets(el);
      const plainLength = htmlToPlainText(el.innerHTML).length;
      if (offsets && offsets.start === plainLength && offsets.end === plainLength) {
        e.preventDefault();
        focusNextVisible(node.id);
      }
      return;
    }
  }

  function handleInput() {
    maybeReplaceEllipsis();
    commitFromDom();
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    // contenteditable内のリンクは既定では(編集用のキャレット配置になるだけで)遷移しないため、
    // クリックされたのがリンクなら明示的に新しいタブで開く
    const link = (e.target as HTMLElement).closest("a");
    if (link instanceof HTMLAnchorElement && link.href) {
      e.preventDefault();
      window.open(link.href, "_blank", "noopener,noreferrer");
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = editorRef.current;
    if (!el) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length <= 1) {
      document.execCommand("insertText", false, text);
      commitFromDom();
      return;
    }

    // 複数行のペーストは1行目をこのノードに、残りは新しい兄弟ノードとして展開する
    const offsets = getSelectionOffsets(el);
    if (offsets && offsets.start !== offsets.end) {
      document.execCommand("delete");
    }
    const caretPos = getSelectionOffsets(el)?.start ?? 0;
    const currentHtml = el.innerHTML;
    const [before] = splitHtmlAtOffset(currentHtml, caretPos);
    const firstLineHtml = before + escapeHtml(lines[0]);
    el.innerHTML = firstLineHtml;
    lastKnownContentRef.current = firstLineHtml;
    pasteLines(node.id, caretPos, lines);
  }

  const placeholder =
    node.nodeType === "normal" ? "入力…" : getSmartBlockDef(node.nodeType).placeholder;

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onDrop={(e) => e.preventDefault()}
      onClick={handleClick}
      onFocus={() => {
        isFocusedRef.current = true;
        setActiveNodeId(node.id);
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        const el = editorRef.current;
        if (!el) return;
        const linked = linkifyHtml(el.innerHTML);
        const sanitized = sanitizeHtml(linked);
        const normalized = isEmptyHtml(sanitized) ? "" : sanitized;
        if (normalized !== el.innerHTML) el.innerHTML = normalized;
        lastKnownContentRef.current = normalized;
        updateNodeContent(node.id, normalized);
      }}
      className={clsx(
        "w-full flex-1 whitespace-pre-wrap break-words leading-relaxed text-ink-800 outline-none",
        "empty:before:pointer-events-none empty:before:text-ink-300 empty:before:content-[attr(data-placeholder)]",
        getAutoFontSizeClass(depth, insideSmartBlock)
      )}
      style={{ color: selected ? SELECTED_TEXT_HEX : node.textColor ?? undefined }}
    />
  );
});
