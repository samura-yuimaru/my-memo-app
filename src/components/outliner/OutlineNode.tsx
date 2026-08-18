"use client";

import { useRef } from "react";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { countDescendants } from "@/lib/utils/tree";
import { htmlToPlainText } from "@/lib/utils/richText";
import { safeSetPointerCapture } from "@/lib/utils/dnd";
import { IconButton } from "@/components/ui/IconButton";
import { HOVER_REVEAL } from "@/lib/uiClasses";
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

  return (
    <div>
      {isDropTarget && dragOver?.position === "before" && <DropLine depth={depth} />}

      <div
        data-node-id={node.id}
        className={clsx(
          "group/actions relative flex items-center gap-0.5 rounded-md px-1 py-0.5",
          isDropTarget && dragOver?.position === "into" && "ring-2 ring-accent-400 bg-accent-50/60 dark:bg-accent-500/10",
          isMultiSelected
            ? "bg-accent-100 dark:bg-accent-500/20"
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
          />
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <SmartBlockMenu onInsert={(type) => insertSmartBlock(node.id, type)} />
          <NodeStylePopover
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
            className={clsx(HOVER_REVEAL, "hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400")}
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

function DropLine({ depth }: { depth: number }) {
  return (
    <div
      className="my-0.5 h-0.5 rounded-full bg-accent-400"
      style={{ marginLeft: depth * INDENT_WIDTH + 8 }}
    />
  );
}
