"use client";

import { useCallback, useRef } from "react";

interface LongPressInfo {
  pointerId: number;
  target: Element;
}

interface UseLongPressOptions {
  /** 長押し閾値(delay)に達した瞬間に呼ばれる。ドラッグの「持ち上げ」に使う想定
   *  (以降そのまま指を動かせば、既存のドラッグ&ドロップ処理にそのまま引き継がれる) */
  onLongPress: (info: LongPressInfo) => void;
  /** 長押し閾値に達した後、指を動かさずに離した場合にだけ呼ばれる(名前変更の起動などの単発アクション用) */
  onLongPressRelease?: () => void;
  /** 長押しと判定するまでの時間(ms) */
  delay?: number;
  /** これを超えて動いたら「長押し」ではなく通常のスクロール/クリックとみなしてキャンセルする距離(px) */
  moveThreshold?: number;
  /** trueの場合マウス(pointerType==="mouse")では発火しない。既存のマウス専用ハンドル操作と競合させないため */
  touchOnly?: boolean;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

/**
 * 「指を動かさずに一定時間押し続けた」ことを検出する汎用フック(iPad/スマホでの
 * 長押しドラッグ・長押しリネームに使う)。
 * - delay経過時点で onLongPress を呼ぶ
 * - delay経過後、動かさずに指を離すと onLongPressRelease を呼ぶ
 * - delay到達前に指がmoveThresholdを超えて動く、またはマウス操作の場合は何もしない
 *   (通常のタップ/クリック/スクロールをそのまま素通しする)
 */
export function useLongPress({
  onLongPress,
  onLongPressRelease,
  delay = 420,
  moveThreshold = 10,
  touchOnly = true,
}: UseLongPressOptions): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const movedRef = useRef(false);
  const infoRef = useRef<LongPressInfo | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    armedRef.current = false;
    movedRef.current = false;
    infoRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (touchOnly && e.pointerType === "mouse") return;
      if (e.button !== 0) return;
      reset();
      startRef.current = { x: e.clientX, y: e.clientY };
      // currentTargetはイベントハンドラを抜けるとReactによってnullされるため、
      // 実体(DOM要素)はここで同期的に取り出してrefへ保存しておく
      infoRef.current = { pointerId: e.pointerId, target: e.currentTarget };
      timerRef.current = setTimeout(() => {
        armedRef.current = true;
        if (infoRef.current) onLongPress(infoRef.current);
      }, delay);
    },
    [delay, onLongPress, reset, touchOnly]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.hypot(dx, dy) <= moveThreshold) return;
      movedRef.current = true;
      // 長押し確定前に動いた場合は完全にキャンセルする(スクロール等をそのまま許可する)
      if (!armedRef.current) reset();
    },
    [moveThreshold, reset]
  );

  const onPointerUp = useCallback(() => {
    if (armedRef.current && !movedRef.current) onLongPressRelease?.();
    reset();
  }, [onLongPressRelease, reset]);

  const onPointerCancel = useCallback(() => {
    reset();
  }, [reset]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
