/**
 * サイドバー最上部のブランドヘッダー。アプリアイコン(ファビコン・ホーム画面アイコンと
 * 同じ「青い角丸スクエア + 3本の白いアウトライン(バー)」のロゴ)+ アプリ名だけの
 * 簡潔な構成にしている。アイコンはpublic/icons配下のPNG(favicon・apple-touch-icon・
 * PWAアイコン)と同一デザインをSVGで再現したもの(どの表示サイズでも滲まないようにするため)。
 */
export function BrandHeader() {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-3.5">
      <svg
        viewBox="0 0 24 24"
        width={28}
        height={28}
        className="shrink-0 rounded-[7px] shadow-sm"
        aria-hidden="true"
      >
        <rect width={24} height={24} rx={5.5} fill="#3c66ea" />
        <rect x={6} y={8.5} width={12} height={2} rx={1} fill="#ffffff" />
        <rect x={6} y={12} width={9} height={2} rx={1} fill="#ffffff" />
        <rect x={6} y={15.5} width={6} height={2} rx={1} fill="#ffffff" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink-800">My Memo</span>
    </div>
  );
}
