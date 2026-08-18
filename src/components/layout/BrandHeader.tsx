import { NotebookPen } from "lucide-react";

/**
 * サイドバー最上部のブランドヘッダー。海外のミニマルな生産性アプリ(Linear/Notion等)を
 * 参考に、単色グラデーションの小さなアプリアイコン + アプリ名だけの簡潔な構成にしている。
 */
export function BrandHeader() {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-3.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-sm">
        <NotebookPen size={15} strokeWidth={2.25} />
      </div>
      <span className="text-[15px] font-semibold tracking-tight text-ink-800">My Memo</span>
    </div>
  );
}
