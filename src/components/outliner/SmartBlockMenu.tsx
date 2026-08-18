"use client";

import { useState } from "react";
import { Box } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { Popover } from "@/components/ui/Popover";
import { SMART_BLOCKS } from "@/lib/smartBlocks";
import { HOVER_REVEAL } from "@/lib/uiClasses";
import type { SmartBlockType } from "@/types/outline";

interface SmartBlockMenuProps {
  onInsert: (type: SmartBlockType) => void;
}

/** 「なぜ重要なのか」等、Axios風スマート構造化ブロックを挿入するメニュー */
export function SmartBlockMenu({ onInsert }: SmartBlockMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-flex">
      <IconButton
        label="スマート構造化"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className={HOVER_REVEAL}
      >
        <Box size={15} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} className="md:right-0 md:top-full md:mt-1 md:w-64">
        <div className="mb-1 px-2 pt-1 text-[11px] font-medium text-ink-400">
          スマート構造化
        </div>
        <div className="flex flex-col gap-0.5">
          {SMART_BLOCKS.map((block) => {
            const Icon = block.icon;
            return (
              <button
                key={block.type}
                type="button"
                onClick={() => {
                  onInsert(block.type);
                  setOpen(false);
                }}
                className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-ink-50"
              >
                <span className={`mt-0.5 rounded p-1 ${block.badgeClass}`}>
                  <Icon size={14} strokeWidth={2.5} />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-ink-800">{block.label}</span>
                  <span className="text-xs text-ink-400">{block.sublabel}</span>
                </span>
                <kbd className="ml-auto mt-1 shrink-0 rounded border border-ink-200 px-1 text-[10px] text-ink-400">
                  ⌘⇧{block.shortcutKey}
                </kbd>
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
