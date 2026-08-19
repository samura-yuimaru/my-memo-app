"use client";

import { useCallback, useRef } from "react";
import { safeSetPointerCapture } from "@/lib/utils/dnd";
import { useLongPress, type LongPressHandlers } from "@/lib/utils/useLongPress";

interface UseRowDragOptions {
  /** タッチの長押し、またはマウスのしきい値超え移動で呼ばれる。ドラッグの「持ち上げ」に使う */
  onStartDrag: () => void;
  /** 長押し後、動かさずに指を離した場合にだけ呼ばれる(メモの名前変更の起動などに使う) */
  onLongPressRelease?: () => void;
  /** マウスでこの距離を超えて動いたら、クリックではなくドラッグ開始とみなす(px) */
  mouseDragThreshold?: number;
}

/**
 * サイドバーの行(フォルダ・メモ共通)を、行のどこを押してもドラッグ開始できるようにする
 * 組み合わせフック。FolderNode/NoteRowの行コンテナに直接スプレッドして使う。
 * ・タッチ/ペン: 長押し(既定420ms)でドラッグを開始する。長押し確定前に指が動いた場合は
 *   何もしない(通常のスクロール/タップとしてそのまま機能する)
 * ・マウス: 一定距離(既定4px)を超えて動いた瞬間にドラッグを開始する。ただのクリック
 *   (移動なし)ではドラッグが一切始まらない
 * 行内の削除ボタン・「…」メニュー・折りたたみ矢印・名前変更用input等、
 * 「ドラッグの起点にしたくない」操作要素には data-no-drag を付けておくと、
 * そこを押してもドラッグが起動しない(通常のクリック操作はそのまま機能する)。
 */
export function useRowDrag({
  onStartDrag,
  onLongPressRelease,
  mouseDragThreshold = 4,
}: UseRowDragOptions): LongPressHandlers {
  const longPress = useLongPress({
    onLongPress: ({ pointerId, target }) => {
      safeSetPointerCapture(target, pointerId);
      onStartDrag();
    },
    onLongPressRelease,
  });
  const mouseDragRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-no-drag]")) return;
      if (e.pointerType === "mouse") {
        if (e.button !== 0) return;
        mouseDragRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        return;
      }
      longPress.onPointerDown(e);
    },
    [longPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") {
        const start = mouseDragRef.current;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > mouseDragThreshold) {
          safeSetPointerCapture(e.currentTarget, start.pointerId);
          onStartDrag();
          mouseDragRef.current = null;
        }
        return;
      }
      longPress.onPointerMove(e);
    },
    [longPress, mouseDragThreshold, onStartDrag]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      mouseDragRef.current = null;
      longPress.onPointerUp(e);
    },
    [longPress]
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      mouseDragRef.current = null;
      longPress.onPointerCancel(e);
    },
    [longPress]
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
