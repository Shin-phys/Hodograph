/* =====================================================================
   ui/timeline.js — タイムライン（コマ位置・トリム区間・打点済みコマ）

   打点済みのコマとまだ打っていないコマが一目で分かるようにしてある。
   ===================================================================== */
(function (HG) {
  'use strict';

  let tl = null, ctx = null, dragging = false;

  function attach(canvas) {
    tl = canvas;
    ctx = tl.getContext('2d');
    tl.addEventListener('pointerdown', e => { dragging = true; tl.setPointerCapture(e.pointerId); seek(e); });
    tl.addEventListener('pointermove', e => { if (dragging) seek(e); });
    tl.addEventListener('pointerup', () => { dragging = false; });
    tl.addEventListener('pointercancel', () => { dragging = false; });
  }

  function seek(ev) {
    const r = tl.getBoundingClientRect();
    const N = HG.state.frames.length - 1 || 1;
    const p = (ev.clientX - r.left) / r.width;
    HG.frames.showFrame(Math.round(Math.max(0, Math.min(1, p)) * N));
  }

  function draw() {
    if (!tl || !HG.state.frames.length) return;
    const cssW = tl.parentElement.clientWidth, cssH = 52;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (tl.width !== Math.round(cssW * d)) {
      tl.width = Math.round(cssW * d);
      tl.height = Math.round(cssH * d);
      tl.style.width = cssW + 'px';
      tl.style.height = cssH + 'px';
    }
    const W = tl.width, H = tl.height;
    const N = HG.state.frames.length - 1 || 1;
    const px = i => (i / N) * (W - 4 * d) + 2 * d;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e6e9ee';
    ctx.fillRect(0, H * 0.35, W, H * 0.30);

    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? N : HG.state.trim.outIndex);
    ctx.fillStyle = '#cfe2f8';
    ctx.fillRect(px(inI), H * 0.35, px(outI) - px(inI), H * 0.30);

    ctx.fillStyle = '#0b6bcb';
    [inI, outI].forEach(i => ctx.fillRect(px(i) - 2 * d, H * 0.22, 4 * d, H * 0.56));

    ctx.fillStyle = '#ff2d6f';
    for (const f of HG.state.frames) {
      if (!f.found) continue;
      ctx.fillRect(px(f.index) - 1.5 * d, H * 0.08, 3 * d, H * 0.22);
    }

    ctx.fillStyle = '#12161c';
    ctx.fillRect(px(HG.ui.current) - 1 * d, H * 0.14, 2 * d, H * 0.72);
    ctx.beginPath();
    ctx.arc(px(HG.ui.current), H * 0.90, 5 * d, 0, Math.PI * 2);
    ctx.fill();
  }

  HG.timeline = { attach, draw };
})(window.HG = window.HG || {});
