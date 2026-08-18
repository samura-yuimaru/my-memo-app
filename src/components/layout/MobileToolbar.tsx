"use client";

import type { ReactNode } from "react";
import { ChevronRight, ChevronsLeft, ChevronsRight, Redo2, Undo2 } from "lucide-react";
import clsx from "clsx";
import { useOutlineStore } from "@/lib/store/useOutlineStore";
import { IconButton } from "@/components/ui/IconButton";

/**
 * 画面下部に常駐する操作バー。フリック入力中でも親指だけで
 * インデント・折りたたみ・元に戻す/やり直すができるようにする(iPad/スマホの片手操作対応、
 * PCでもキーボードショートカットの代わりにクリックで使える)。
 * インデント系は「現在フォーカス/選択中のノード」(activeNodeId)に対して操作する。
 * 並べ替えはドラッグ&ドロップに一本化したため、上下移動ボタンは置かない。
 */
export function MobileToolbar() {
  const currentNoteId = useOutlineStore((s) => s.currentNoteId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const activeNode = useOutlineStore((s) => (s.activeNodeId ? s.nodes[s.activeNodeId] ?? null : null));
  const hasChildren = useOutlineStore((s) =>
    s.activeNodeId ? Object.values(s.nodes).some((n) => n.parentId === s.activeNodeId) : false
  );
  const canUndo = useOutlineStore((s) => s.undoStack.length > 0);
  const canRedo = useOutlineStore((s) => s.redoStack.length > 0);

  const indentNode = useOutlineStore((s) => s.indentNode);
  const outdentNode = useOutlineStore((s) => s.outdentNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const undo = useOutlineStore((s) => s.undo);
  const redo = useOutlineStore((s) => s.redo);

  if (!currentNoteId) return null;

  const noSelection = !activeNodeId;

  const structureButtons: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }[] = [
    {
      label: "インデントを上げる(親と同じ階層に戻す)",
      icon: <ChevronsLeft size={19} />,
      onClick: () => activeNodeId && outdentNode(activeNodeId),
      disabled: noSelection,
    },
    {
      label: "インデントを下げる(1つ上の子にする)",
      icon: <ChevronsRight size={19} />,
      onClick: () => activeNodeId && indentNode(activeNodeId),
      disabled: noSelection,
    },
    {
      label: activeNode?.collapsed ? "展開する" : "折りたたむ",
      icon: (
        <ChevronRight
          size={19}
          className={clsx("transition-transform", activeNode && !activeNode.collapsed && "rotate-90")}
        />
      ),
      onClick: () => activeNodeId && toggleCollapse(activeNodeId),
      disabled: noSelection || !hasChildren,
    },
  ];

  const historyButtons: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }[] = [
    {
      label: "元に戻す",
      icon: <Undo2 size={19} />,
      onClick: () => undo(),
      disabled: !canUndo,
    },
    {
      label: "やり直す",
      icon: <Redo2 size={19} />,
      onClick: () => redo(),
      disabled: !canRedo,
    },
  ];

  return (
    <div
      className="sticky bottom-0 z-20 flex flex-wrap items-center justify-center gap-1 border-t border-ink-100 bg-surface/95 px-2 py-1.5 backdrop-blur"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
    >
      {structureButtons.map((b) => (
        <IconButton key={b.label} label={b.label} size="lg" onClick={b.onClick} disabled={b.disabled}>
          {b.icon}
        </IconButton>
      ))}
      <span className="mx-1 h-6 w-px shrink-0 bg-ink-200" aria-hidden="true" />
      {historyButtons.map((b) => (
        <IconButton key={b.label} label={b.label} size="lg" onClick={b.onClick} disabled={b.disabled}>
          {b.icon}
        </IconButton>
      ))}
    </div>
  );
}
