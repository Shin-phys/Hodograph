/* =====================================================================
   ui/hodograph.js — 別枠（ホドグラフ）の座標系と3つの表示モード

   ③で速度ベクトルの始点を原点に集めた図はホドグラフ（速度図）。
   先端が描く軌跡が運動の性格を表す。加速度とは「ホドグラフ上を先端が
   動く速さ」であり、位置の軌跡に対する速度とまったく同じ関係にある。

   現象によってホドグラフの形が違うため、見せ方を統一できない。
     全集合   加速度が一定な運動でのみ有効。10本がぴたり重なることが結論
     ペア送り 加速度が向きを変える運動（円運動・振り子）の既定
     階段     一次元運動。始点を少しずつずらして重なりを解く

   ★ 階段モードは「横軸＝時間」の図（＝ v-t グラフ）である ★
   段のずれは等間隔＝等時間なので、先端を結んだ線の傾きが加速度になる。
   ただし**先端を結んだ斜めの線そのものは Δv ではない**（段差が乗っている）。
   斜めの線は補助線として細く描き、段差を引いた本当の Δv を実線で描く。
   段差は gapRatio（0〜1）で連続に縮められる。0 にすると全集合と一致する。

   配置はすべて「いま表示している範囲」（HG.coords.area()）を基準に決める。
   動画全体で決めると、クロップ（軌道に合わせる）したときや、縦長の動画で
   矢印が画面の外に出る（実際に自由落下で踏んだ不具合）。
   ===================================================================== */
(function (HG) {
  'use strict';

  const H = { mode: 'all', pair: 0, zoom: 1, pan: { x: 0, y: 0 }, gapRatio: 1 };

  function A() { return HG.coords.area(); }
  function count() { return Math.max(0, HG.drawing.counts().n - 1); }   // 矢印の本数

  function maxLen() {
    let max = 0;
    for (let k = 0; k < count(); k++) {
      const v = HG.drawing.velocity(k);
      if (v) max = Math.max(max, Math.hypot(v.dx, v.dy));
    }
    return max;
  }

  function meanVel() {
    let sx = 0, sy = 0;
    for (let k = 0; k < count(); k++) {
      const v = HG.drawing.velocity(k);
      if (v) { sx += v.dx; sy += v.dy; }
    }
    return { dx: sx, dy: sy };
  }

  /** 段を積む向き。運動が主に縦なら右（＝横軸が時間）、主に横なら下 */
  function stairAxis() {
    const m = meanVel();
    return Math.abs(m.dy) >= Math.abs(m.dx) ? { x: 1, y: 0 } : { x: 0, y: 1 };
  }

  /** 階段モードの配置（表示範囲に収まるように決める） */
  function stairLayout() {
    const a = A(), m = meanVel(), axis = stairAxis();
    const n = Math.max(1, count());
    const along = axis.x ? a.w : a.h;          // 段を並べる方向の長さ
    const across = axis.x ? a.h : a.w;         // 矢印が伸びる方向の長さ
    const gapMax = Math.min(along * 0.80 / Math.max(1, n - 1), Math.min(a.w, a.h) * 0.12);
    const gap = gapMax * H.gapRatio;
    const scale = maxLen() > 1e-6 ? (across * 0.60) / maxLen() : 1;

    /* 矢印が伸びる側に余白を残して始点を置く */
    const fwd = axis.x ? (m.dy >= 0) : (m.dx >= 0);
    const base = axis.x
      ? { x: a.x + a.w * 0.10, y: a.y + across * (fwd ? 0.16 : 0.84) }
      : { x: a.x + across * (fwd ? 0.12 : 0.88), y: a.y + a.h * 0.12 };
    return { base: base, gap: gap, axis: axis, scale: scale, n: n };
  }

  /** 別枠の原点（元解像度座標） */
  function base() {
    const a = A();
    if (H.mode === 'stair') {
      const L = stairLayout();
      return { x: L.base.x + H.pan.x, y: L.base.y + H.pan.y };
    }
    return { x: a.x + a.w * 0.34 + H.pan.x, y: a.y + a.h * 0.55 + H.pan.y };
  }

  /** 速度ベクトルを見やすい長さにする倍率 */
  function scale() { return baseScale() * H.zoom; }

  function baseScale() {
    if (H.mode === 'stair') return stairLayout().scale;
    const a = A(), max = maxLen();
    if (max < 1e-6) return 1;
    return Math.min(a.w, a.h) * 0.34 / max;
  }

  /** 拡大したときに、見たい先端が画面の中央に来るようにする */
  function autoPan() {
    H.pan = { x: 0, y: 0 };
    if (H.zoom <= 1) return;
    const a = A(), xs = [], ys = [];
    for (let i = 0; i < count(); i++) {
      if (H.mode === 'pair' && i !== H.pair && i !== H.pair + 1) continue;
      const t = tip(i);
      if (t) { xs.push(t.x); ys.push(t.y); }
    }
    if (!xs.length) return;
    const cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    const cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    H.pan = { x: a.x + a.w * 0.5 - cx, y: a.y + a.h * 0.5 - cy };
  }

  function stairGap() { return H.mode === 'stair' ? stairLayout().gap : 0; }
  function stairDir() { return H.mode === 'stair' ? stairLayout().axis : { x: 0, y: 0 }; }

  /** k 本目の速度ベクトルの始点（元解像度座標） */
  function originFor(k) {
    const b = base();
    if (H.mode !== 'stair') return b;
    const L = stairLayout();
    return { x: b.x + L.axis.x * L.gap * k, y: b.y + L.axis.y * L.gap * k };
  }

  /** この番号の矢印を今のモードで表示するか */
  function visible(k) {
    if (H.mode !== 'pair') return true;
    return k === H.pair || k === H.pair + 1;
  }

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

  /** 先端どうしを結んだ線の終点（段差が乗っている＝見かけの向き） */
  function deltaVEnd(k, dv) {
    const t = tip(k), o0 = originFor(k), o1 = originFor(k + 1), s = scale();
    if (!t) return null;
    return { x: t.x + dv.dx * s + (o1.x - o0.x), y: t.y + dv.dy * s + (o1.y - o0.y) };
  }

  /** 段差を引いた本当の Δv の終点 */
  function deltaVTrue(k, dv) {
    const t = tip(k), s = scale();
    if (!t) return null;
    return { x: t.x + dv.dx * s, y: t.y + dv.dy * s };
  }

  /* --- 描画 --- */
  function drawAxes(ctx) {
    const b = base(), d = HG.view.dpr;
    const B = HG.coords.toCanvas(b.x, b.y);
    const cv = HG.stage.canvas();
    ctx.save();

    if (H.mode === 'stair') {
      drawTimeAxis(ctx);
    } else {
      ctx.strokeStyle = 'rgba(90,110,130,.45)';
      ctx.lineWidth = 1 * d;
      ctx.setLineDash([5 * d, 4 * d]);
      ctx.beginPath();
      ctx.moveTo(0, B.y); ctx.lineTo(cv.width, B.y);
      ctx.moveTo(B.x, 0); ctx.lineTo(B.x, cv.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(60,80,100,.9)';
    ctx.beginPath(); ctx.arc(B.x, B.y, 4 * d, 0, Math.PI * 2); ctx.fill();
    /* 見出しは、階段モードでは時間軸のラベルとぶつかるので下に置く */
    ctx.font = (11 * d) + 'px sans-serif';
    ctx.textAlign = 'left';
    if (H.mode === 'stair') {
      ctx.textBaseline = 'bottom';
      ctx.fillText('別枠：横が時間、縦が速度（v-t グラフ）', 6 * d, cv.height - 6 * d);
    } else {
      ctx.textBaseline = 'top';
      ctx.fillText('別枠：速度ベクトルの始点をそろえた図（ホドグラフ）', 6 * d, 6 * d);
    }
    ctx.restore();
  }

  /**
   * 階段モードの「時間」軸。
   * 段のずれは等間隔＝等時間。これを名前のないずれのままにしておくと、
   * 生徒には「なぜか横にずれている」としか見えない。
   */
  function drawTimeAxis(ctx) {
    const L = stairLayout(), d = HG.view.dpr;
    const p = HG.drawing.pts();
    if (L.gap < 1e-6) {
      ctx.fillStyle = 'rgba(60,80,100,.8)';
      ctx.font = (11 * d) + 'px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.textBaseline = 'top';
      ctx.fillText('段差 0：すべて同じ始点に重ねています', 6 * d, 6 * d);
      return;
    }
    const b = base();
    const last = originFor(L.n - 1);
    const S = HG.coords.toCanvas(b.x, b.y);
    const E = HG.coords.toCanvas(last.x + L.axis.x * L.gap * 0.5, last.y + L.axis.y * L.gap * 0.5);

    ctx.save();
    ctx.strokeStyle = 'rgba(90,110,130,.6)';
    ctx.fillStyle = 'rgba(60,80,100,.85)';
    ctx.lineWidth = 1.2 * d;
    ctx.beginPath(); ctx.moveTo(S.x, S.y); ctx.lineTo(E.x, E.y); ctx.stroke();

    /* 目盛り（各段＝1コマ間隔ぶんの時間） */
    for (let k = 0; k < L.n; k++) {
      const o = originFor(k);
      const T = HG.coords.toCanvas(o.x, o.y);
      ctx.beginPath();
      ctx.moveTo(T.x - L.axis.y * 4 * d, T.y - L.axis.x * 4 * d);
      ctx.lineTo(T.x + L.axis.y * 4 * d, T.y + L.axis.x * 4 * d);
      ctx.stroke();
    }
    /* ラベルは矢印と反対側に置く。矢印の上に重ねると読めない */
    const m = meanVel();
    const fwd = L.axis.x ? (m.dy >= 0) : (m.dx >= 0);
    const off = 10 * d * (fwd ? -1 : 1);
    ctx.font = (11 * d) + 'px sans-serif';
    ctx.fillStyle = 'rgba(60,80,100,.9)';
    const dt = (p[1] && p[0]) ? ((p[1].t - p[0].t) * 1000).toFixed(0) + ' ms' : '';
    const txt = '→ 時間' + (dt ? '（1目盛り ' + dt + '）' : '');
    if (L.axis.x) {
      ctx.textAlign = 'right'; ctx.textBaseline = fwd ? 'bottom' : 'top';
      ctx.fillText(txt, E.x, E.y + off);
    } else {
      ctx.textAlign = fwd ? 'right' : 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(txt, E.x + off, E.y);
    }
    ctx.restore();
  }

  HG.hodo = {
    state: H,
    base, scale, originFor, visible, tip, toDeltaV, deltaVEnd, deltaVTrue,
    drawAxes, stairDir, stairGap, stairLayout, autoPan,
    setMode(m) { H.mode = m; autoPan(); },
    setPair(i) { H.pair = i; autoPan(); },
    setZoom(z) { H.zoom = z; autoPan(); },
    setGap(r) { H.gapRatio = r; autoPan(); }
  };
})(window.HG = window.HG || {});
