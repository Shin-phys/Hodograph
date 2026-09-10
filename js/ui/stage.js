/* =====================================================================
   ui/stage.js — メインキャンバス（動画のコマ＋その上の描き物）

   フレームを描いたあと、登録された painter を順に呼ぶ。
   フェーズ4の矢印描画は stage.js を触らずに painter を足すだけでよい。
     例）HG.stage.register(HG.arrows.draw)
   ===================================================================== */
(function (HG) {
  'use strict';

  const painters = [];
  let cv = null, ctx = null;
  let source = null;      // null なら動画のコマ。ストロボ画像を出すときはその canvas

  function attach(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
  }

  function register(fn) { painters.push(fn); }

  /** キャンバスの大きさを映像の縦横比に合わせ、表示縮尺を決める */
  function fit() {
    const ew = HG.state.video.width, eh = HG.state.video.height;
    if (!ew || !eh || !cv) return;
    const cssW = cv.parentElement.clientWidth;
    HG.view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssH = Math.round(cssW * eh / ew);
    const w = Math.round(cssW * HG.view.dpr), h = Math.round(cssH * HG.view.dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w; cv.height = h;
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
    }
    HG.view.scale = cv.width / ew;   // 元解像度 → キャンバス実ピクセル
  }

  /**
   * 背景を差し替える。null で動画のコマに戻る。
   * ストロボ画像は元解像度と同じ画角なので、表示縮尺はそのまま使える。
   */
  function setSource(canvas) { source = canvas || null; }
  function mode() { return source ? 'strobe' : 'video'; }

  function render() {
    if (!cv || !HG.state.frames.length) return;
    fit();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (source) {
      ctx.drawImage(source, 0, 0, cv.width, cv.height);
    } else {
      HG.frames.drawToOffscreen();
      ctx.drawImage(HG.frames.offscreen, 0, 0, cv.width, cv.height);
    }
    painters.forEach(p => {
      try { p(ctx); } catch (e) { console.error('[painter]', e); }
    });
  }

  HG.stage = { attach, register, render, setSource, mode, canvas: () => cv, ctx: () => ctx };
})(window.HG = window.HG || {});
