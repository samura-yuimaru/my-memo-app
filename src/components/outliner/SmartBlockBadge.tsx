import clsx from "clsx";
import { getSmartBlockDef } from "@/lib/smartBlocks";
import type { SmartBlockType } from "@/types/outline";

/** Axios風スマート構造化ブロックのラベルバッジ(日本語 + 元表現の添え書き) */
export function SmartBlockBadge({ type }: { type: SmartBlockType }) {
  const def = getSmartBlockDef(type);
  const Icon = def.icon;
  return (
    <span
      className={clsx(
        "mb-1 inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1",
        def.badgeClass
      )}
    >
      <Icon size={13} strokeWidth={2.5} />
      {def.label}
      <span className="font-normal opacity-60">/ {def.sublabel}</span>
    </span>
  );
}
