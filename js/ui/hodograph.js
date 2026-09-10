/* =====================================================================
   ui/hodograph.js — 別枠（ホドグラフ）の座標系と3つの表示モード

   ③で速度ベクトルの始点を原点に集めた図はホドグラフ（速度図）。
   先端が描く軌跡が運動の性格を表す。加速度とは「ホドグラフ上を先端が
   動く速さ」であり、位置の軌跡に対する速度とまったく同じ関係にある。

   現象によってホドグラフの形が違うため、見せ方を統一できない。
     全集合   加速度が一定な運動でのみ有効。10本がぴたり重なることが結論
     ペア送り 加速度が向きを変える運動（円運動・振り子）の既定
     階段     一次元運動。始点を少しずつずらして重なりを解く

   別枠は下に置かず、同じキャンバス上で切り替える。390px 幅の縦画面で
   上下に積むと、③の「矢印が滑って原点に集まる」動きが画面外に出る。
   あの動きが見えないなら③をやる意味が半減する。
   ===================================================================== */
(function (HG) {
  'use strict';

  const H = { mode: 'all', pair: 0, zoom: 1, pan: { x: 0, y: 0 } };

  function W() { return HG.state.video.width; }
  function Hh() { return HG.state.video.height; }

  /** 別枠の原点（元解像度座標） */
  function base() {
    const b = H.mode === 'stair'
      ? { x: W() * 0.22, y: Hh() * 0.22 }
      : { x: W() * 0.34, y: Hh() * 0.55 };
    return { x: b.x + H.pan.x, y: b.y + H.pan.y };
  }

  /**
   * 速度ベクトルを見やすい長さにする倍率。
   * 既定は「いちばん長い速度ベクトルの先端が画面に入る」倍率。
   * ただし |Δv| / |v| が小さい運動では先端どうしの間隔が数ピクセルになり、
   * 指で Δv を引けない。そのための拡大が zoom（原点は画面外に出るので、
   * ペア送りでは対象の先端が画面に入るよう自動でパンする）。
   */
  function scale() { return baseScale() * H.zoom; }

  function baseScale() {
    const n = HG.drawing.counts().n;
    let max = 0;
    for (let k = 0; k < n - 1; k++) {
      const v = HG.drawing.velocity(k);
      if (v) max = Math.max(max, Math.hypot(v.dx, v.dy));
    }
    if (max < 1e-6) return 1;
    return Math.min(W(), Hh()) * 0.34 / max;
  }

  /** 拡大したときに、見たい先端が画面の中央に来るようにする */
  function autoPan() {
    H.pan = { x: 0, y: 0 };
    if (H.zoom <= 1) return;
    const n = HG.drawing.counts().n;
    const xs = [], ys = [];
    for (let i = 0; i < n - 1; i++) {
      if (H.mode === 'pair' && i !== H.pair && i !== H.pair + 1) continue;
      const t = tip(i);
      if (t) { xs.push(t.x); ys.push(t.y); }
    }
    if (!xs.length) return;
    const cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    const cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    H.pan = { x: W() * 0.5 - cx, y: Hh() * 0.5 - cy };
  }

  /** 階段モードで積む方向＝平均の速度に垂直な向き */
  function stairDir() {
    const n = HG.drawing.counts().n;
    let sx = 0, sy = 0;
    for (let k = 0; k < n - 1; k++) {
      const v = HG.drawing.velocity(k);
      if (v) { sx += v.dx; sy += v.dy; }
    }
    const len = Math.hypot(sx, sy) || 1;
    return { x: -sy / len, y: sx / len };          // 90°回した向き
  }

  function stairGap() { return Math.min(W(), Hh()) * 0.07; }

  /** k 本目の速度ベクトルの始点（元解像度座標） */
  function originFor(k) {
    const b = base();
    if (H.mode !== 'stair') return b;
    const d = stairDir(), g = stairGap();
    return { x: b.x + d.x * g * k, y: b.y + d.y * g * k };
  }

  /** この番号の矢印を今のモードで表示するか */
  function visible(k) {
    if (H.mode !== 'pair') return true;
    return k === H.pair || k === H.pair + 1;
  }

  /* --- 座標変換（元解像度 ↔ 速度ベクトル） --- */
  function tip(k) {
    const v = HG.drawing.velocity(k), o = originFor(k), s = scale();
    if (!v) return null;
    return { x: o.x + v.dx * s, y: o.y + v.dy * s };
  }

  /** 画面で引かれたベクトルを速度の差（Δv）に直す。階段の段差はここで引く */
  function toDeltaV(fromOx, fromOy, toOx, toOy, k) {
    const s = scale();
    const o0 = originFor(k), o1 = originFor(k + 1);
    return {
      dx: ((toOx - fromOx) - (o1.x - o0.x)) / s,
      dy: ((toOy - fromOy) - (o1.y - o0.y)) / s
    };
  }

  /** Δv を画面に描くときの終点（始点は tip(k)） */
  function deltaVEnd(k, dv) {
    const t = tip(k), o0 = originFor(k), o1 = originFor(k + 1), s = scale();
    if (!t) return null;
    return { x: t.x + dv.dx * s + (o1.x - o0.x), y: t.y + dv.dy * s + (o1.y - o0.y) };
  }

  /* --- 描画 --- */
  function drawAxes(ctx) {
    const s = HG.view.scale, b = base(), d = HG.view.dpr;
    ctx.save();
    /* 階段モードは始点をずらして並べる図なので、原点を通る軸は引かない */
    if (H.mode !== 'stair') {
      ctx.strokeStyle = 'rgba(90,110,130,.45)';
      ctx.lineWidth = 1 * d;
      ctx.setLineDash([5 * d, 4 * d]);
      ctx.beginPath();
      ctx.moveTo(0, b.y * s); ctx.lineTo(HG.stage.canvas().width, b.y * s);
      ctx.moveTo(b.x * s, 0); ctx.lineTo(b.x * s, HG.stage.canvas().height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(60,80,100,.9)';
    ctx.beginPath(); ctx.arc(b.x * s, b.y * s, 4 * d, 0, Math.PI * 2); ctx.fill();
    /* ラベルは矢印に重ならないよう画面の隅に置く */
    ctx.font = (11 * d) + 'px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(H.mode === 'stair' ? '別枠：始点を少しずつずらして並べています'
                                    : '別枠：速度ベクトルの始点をそろえた図（ホドグラフ）',
                 6 * d, 6 * d);
    ctx.restore();
  }

  HG.hodo = {
    state: H,
    base, scale, originFor, visible, tip, toDeltaV, deltaVEnd, drawAxes, stairDir, stairGap,
    autoPan,
    setMode(m) { H.mode = m; autoPan(); },
    setPair(i) { H.pair = i; autoPan(); },
    setZoom(z) { H.zoom = z; autoPan(); }
  };
})(window.HG = window.HG || {});
