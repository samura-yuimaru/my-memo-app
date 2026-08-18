/**
 * setPointerCaptureは、ブラウザが「アクティブ」と認識していないpointerId
 * (環境によっては特定の合成イベント経由の操作等)に対して呼ぶと例外を投げることがある。
 * 捕捉に失敗しても、ドロップ判定自体はelementFromPointベースで独立して動くため、
 * ここで例外を握りつぶしてドラッグ開始処理を継続させる(取りこぼし防止の安全策)。
 */
export function safeSetPointerCapture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // 握りつぶす: キャプチャなしでも document 経由のドラッグ検出は機能する
  }
}
