"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { Popover } from "@/components/ui/Popover";

const OPTIONS = [
  { value: "system", label: "システムに合わせる", icon: Monitor },
  { value: "light", label: "ライトモード固定", icon: Sun },
  { value: "dark", label: "ダークモード固定", icon: Moon },
] as const;

/** 表示テーマの切り替え(システム連動 / ライト固定 / ダーク固定) */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  // next-themesはサーバー側でテーマを知り得ないため、マウント前は
  // アイコンを確定させずハイドレーション不一致を避ける
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const CurrentIcon = !mounted
    ? Monitor
    : theme === "system"
    ? Monitor
    : resolvedTheme === "dark"
    ? Moon
    : Sun;

  return (
    <div className="relative inline-flex">
      <IconButton
        label="表示テーマを切り替え"
        onClick={() => setOpen((v) => !v)}
      >
        <CurrentIcon size={17} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} className="md:right-0 md:top-full md:mt-1 md:w-52">
        <div className="mb-1 px-2 pt-1 text-[11px] font-medium text-ink-400">表示テーマ</div>
        <div className="flex flex-col gap-0.5">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = mounted && theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setTheme(opt.value);
                  setOpen(false);
                }}
                className={clsx(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                  selected
                    ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15"
                    : "text-ink-600 hover:bg-ink-50"
                )}
              >
                <Icon size={15} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
