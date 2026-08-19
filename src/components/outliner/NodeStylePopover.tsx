"use client";

import { useState } from "react";
import clsx from "clsx";
import { Baseline } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { Popover } from "@/components/ui/Popover";
import { TEXT_COLOR_PALETTE } from "@/lib/nodeStyles";
import { actionIconClass } from "@/lib/uiClasses";

export interface ActiveColors {
  textColor: string | null;
}

interface NodeStylePopoverProps {
  /** 行が選択中(アクティブ/網掛け)かどうか。falseのときはトリガーアイコン自体を隠す */
  selected: boolean;
  textColor: string | null;
  /** 選択中のテキストがあれば、その部分に実際に適用されている色を返す(なければnull) */
  getActiveColors: () => ActiveColors | null;
  onTextColor: (color: string | null) => void;
}

/** 色を適用する直前のブラウザのデフォルト動作(フォーカス移動)を止め、選択範囲を保持する */
function preserveSelection(e: React.MouseEvent) {
  e.preventDefault();
}

/** 文字色(黒・赤・青)を変更するポップオーバー */
export function NodeStylePopover({ selected, textColor, getActiveColors, onTextColor }: NodeStylePopoverProps) {
  const [open, setOpen] = useState(false);
  // ポップオーバーを開いた瞬間の「実際に選択されている色」を表示に反映する
  // (ノード全体の既定色ではなく、選択範囲そのものの色とスウォッチのズレを防ぐため)
  const [displayTextColor, setDisplayTextColor] = useState(textColor);

  function handleToggle() {
    if (!open) {
      const active = getActiveColors();
      setDisplayTextColor(active ? active.textColor : textColor);
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative inline-flex">
      <IconButton
        label="文字色"
        size="sm"
        onMouseDown={preserveSelection}
        onClick={handleToggle}
        className={actionIconClass(selected || open, { hoverReveal: false })}
      >
        <Baseline size={15} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} className="md:right-0 md:top-full md:mt-1 md:w-44">
        <div className="mb-1.5 flex items-center gap-1 px-1 text-[11px] font-medium text-ink-400">
          <Baseline size={12} /> 文字色
        </div>
        <div className="flex flex-wrap gap-1.5 px-1">
          {TEXT_COLOR_PALETTE.map((c) => (
            <button
              key={c.label}
              type="button"
              title={c.label}
              onMouseDown={preserveSelection}
              onClick={() => {
                onTextColor(c.value);
                setDisplayTextColor(c.value);
              }}
              className={clsx(
                "h-6 w-6 rounded-full border-2",
                displayTextColor === c.value ? "border-accent-500" : "border-transparent"
              )}
              style={{ backgroundColor: c.swatch }}
            />
          ))}
        </div>
      </Popover>
    </div>
  );
}
