"use client";

import { useRef } from "react";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { countDescendants } from "@/lib/utils/tree";
import { htmlToPlainText } from "@/lib/utils/richText";
import { safeSetPointerCapture } from "@/lib/utils/dnd";
import { useLongPress } from "@/lib/utils/useLongPress";
import { IconButton } from "@/components/ui/IconButton";
import { actionIconClass, SELECTED_BG_CLASS, SELECTED_TEXT_CLASS } from "@/lib/uiClasses";
import { ToggleArrow } from "./ToggleArrow";
import { NodeEditor, type NodeEditorHandle } from "./NodeEditor";
import { SmartBlockBadge } from "./SmartBlockBadge";
import { SmartBlockMenu } from "./SmartBlockMenu";
import { NodeStylePopover } from "./NodeStylePopover";
import { useDnd } from "./DndContext";
import type { OutlineTreeNode } from "@/types/outline";

const INDENT_WIDTH = 22;

interface OutlineNodeProps {
  node: OutlineTreeNode;
  depth: number;
  /** 自身またはいずれかの祖先がスマート構造化ブロックかどうか */
  insideSmartBlock?: boolean;
}

/** アウトラインの1行(とその配下)を再帰的に描画する */
export function OutlineNode({ node, depth, insideSmartBlock = false }: OutlineNodeProps) {
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const setTextColor = useOutlineStore((s) => s.setTextColor);
  const insertSmartBlock = useOutlineStore((s) => s.insertSmartBlock);
  const deleteNode = useOutlineStore((s) => s.deleteNode);
  const setActiveNodeId = useOutlineStore((s) => s.setActiveNodeId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const isMultiSelected = useOutlineStore((s) => s.selectedNodeIds.includes(node.id));

  const { dragOver, startDrag } = useDnd();
  const editorRef = useRef<NodeEditorHandle>(null);

  const hasChildren = node.children.length > 0;
  const descendantCount = hasChildren ? countDescendants(node) : 0;
  const isDropTarget = dragOver?.overId === node.id;
  const childInsideSmartBlock = insideSmartBlock || node.nodeType !== "normal";

  function handleDelete() {
    if (hasChildren) {
      const preview = htmlToPlainText(node.content).slice(0, 20) || "このノード";
      const ok = window.confirm(
        `「${preview}」と配下の${descendantCount}件をまとめて削除します。よろしいですか?`
      );
      if (!ok) return;
    }
    deleteNode(node.id);
  }

  // 行頭の6点アイコン(ドラッグハンドル)だけでなく、本文のテキスト部分を含む行全体を
  // 長押しすることでもドラッグ(階層移動)を開始できるようにする(iPadで小さいアイコンを
  // 正確につまむ必要をなくすため)。useLongPressは既定動作をpreventDefaultしないため、
  // 短いタップはそのまま普段どおりカーソル配置・テキスト編集として通り、長押しと
  // 判定された場合だけドラッグへ移行する(タップとドラッグが競合しない)。
  // ボタン・既存のドラッグハンドル上の押下だけは、それぞれ専用の操作があるため対象外にする。
  const rowLongPress = useLongPress({
    onLongPress: ({ pointerId, target }) => {
      // 長押し判定までの間にネイティブのテキスト選択が始まっていた場合に備えて解除しておく
      window.getSelection()?.removeAllRanges();
      safeSetPointerCapture(target, pointerId);
      startDrag(node.id);
      setActiveNodeId(node.id);
    },
  });
  function handleRowPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button, [data-drag-handle], a, input')) return;
    rowLongPress.onPointerDown(e);
  }

  const isSelected = isMultiSelected || activeNodeId === node.id;

  return (
    <div>
      {isDropTarget && dragOver?.position === "before" && <DropLine depth={depth} />}

      <div
        data-node-id={node.id}
        onPointerDown={handleRowPointerDown}
        onPointerMove={rowLongPress.onPointerMove}
        onPointerUp={rowLongPress.onPointerUp}
        onPointerCancel={rowLongPress.onPointerCancel}
        className={clsx(
          "group/actions relative flex items-center gap-0.5 rounded-md px-1 py-0.5",
          isDropTarget &&
            dragOver?.position === "into" &&
            "bg-accent-50/60 shadow-[inset_2px_0_0_0_#2563eb] dark:bg-accent-500/10 dark:shadow-[inset_2px_0_0_0_#38bdf8]",
          isMultiSelected
            ? clsx(SELECTED_BG_CLASS, SELECTED_TEXT_CLASS)
            : activeNodeId === node.id && "bg-accent-50/60 dark:bg-accent-500/10"
        )}
        style={{ paddingLeft: depth * INDENT_WIDTH }}
      >
        {depth > 0 && <IndentGuides depth={depth} />}

        {/*
          行頭アイコンの余白そのものがドラッグハンドルを兼ねる。
          注意: ドラッグ用にsetPointerCaptureを呼ぶと、以降のclickイベントは
          "実際に押した子要素" ではなくキャプチャ先(このdiv自身)に再ターゲットされる。
          そのため折りたたみのクリック判定は内側のボタンではなく、このdiv自身のonClickで行う。
        */}
        <div
          data-drag-handle="true"
          title={hasChildren ? (node.collapsed ? "展開する" : "折りたたむ") : undefined}
          onPointerDown={(e) => {
            safeSetPointerCapture(e.currentTarget, e.pointerId);
            startDrag(node.id);
            setActiveNodeId(node.id);
          }}
          onClick={() => {
            if (hasChildren) toggleCollapse(node.id);
            else setActiveNodeId(node.id);
          }}
          className="flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded hover:bg-ink-100 active:cursor-grabbing"
        >
          <ToggleArrow hasChildren={hasChildren} collapsed={node.collapsed} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {node.nodeType !== "normal" && <SmartBlockBadge type={node.nodeType} />}
          <NodeEditor
            ref={editorRef}
            node={node}
            hasChildren={hasChildren}
            depth={depth}
            insideSmartBlock={insideSmartBlock}
            selected={isMultiSelected}
          />
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <SmartBlockMenu selected={isSelected} onInsert={(type) => insertSmartBlock(node.id, type)} />
          <NodeStylePopover
            selected={isSelected}
            textColor={node.textColor}
            getActiveColors={() => editorRef.current?.getActiveColors() ?? null}
            onTextColor={(v) => {
              if (editorRef.current?.hasSelection()) editorRef.current.applyTextColor(v);
              else setTextColor(node.id, v);
            }}
          />
          <IconButton
            label="このノードを削除"
            size="sm"
            onClick={handleDelete}
            className={clsx(
              actionIconClass(isSelected, { hoverReveal: false }),
              "hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400"
            )}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      {isDropTarget && dragOver?.position === "after" && <DropLine depth={depth} />}

      {!node.collapsed && hasChildren && (
        <div>
          {node.children.map((child) => (
            <OutlineNode key={child.id} node={child} depth={depth + 1} insideSmartBlock={childInsideSmartBlock} />
          ))}
        </div>
      )}
    </div>
  );
}

function IndentGuides({ depth }: { depth: number }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0" aria-hidden="true">
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={i}
          className="absolute top-0 h-full w-px bg-ink-100"
          style={{ left: i * INDENT_WIDTH + 3 }}
        />
      ))}
    </div>
  );
}

/**
 * ドラッグ中の挿入位置を示す棒線インジケーター。シンプルな水平線+先端のドットのみの
 * デザインで、深い階層でも領域が膨らんで表示が崩れることがないようにしている。
 * ライトモードは鮮やかなブルー(#2563EB)、ダークモードは暗い背景でも浮き上がって
 * 見えるシアン寄りのブルー(#38BDF8)にして、どちらのテーマでもはっきり視認できるようにしている。
 */
function DropLine({ depth }: { depth: number }) {
  return (
    <div
      className="relative my-0.5 h-0.5 shrink-0"
      style={{ marginLeft: depth * INDENT_WIDTH + 8 }}
      aria-hidden="true"
    >
      <div className="h-full rounded-full bg-[#2563eb] dark:bg-[#38bdf8]" />
      <span className="absolute left-0 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2563eb] dark:bg-[#38bdf8]" />
    </div>
  );
}
