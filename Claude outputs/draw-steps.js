/* =====================================================================
   ui/draw-steps.js — 作図ステップ①〜⑥（このアプリの本体）

   答えを表示するアプリではない。生徒に作図させるアプリである。
   自動計算した矢印を最初から出すと「見た」で終わり「導いた」にならない。
   ステップは順序制約付きで、前を終えるまで次へ進めない。

   スナップ（磁石）はステップごとに切り替える。
     基準点 … あり（最寄りの黒点）
     ① 位置ベクトル … あり（黒点の中心）
     ② 速度ベクトル … あり（黒点の中心）
     ③ 始点の統一 … 自動
     ④ Δv … **なし**

   ④にスナップを掛けない理由：吸着先は「速度ベクトルの先端」になるが、
   自動で合わせると、生徒は先端を結ぶという操作の意味を考えずに済んで
   しまう。ここが本教材で観察したい思考の場所。
   ①②は磁石が精度を保証して生徒が向きと構造に集中できるようにし、
   その代わり④は自力で合わせさせる。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  const S = {
    on: false,          // 作図モードに入っているか
    step: 0,            // 1..6
    fade: 0,            // ストロボを薄くする度合い
    collecting: false,  // ③のアニメーション中
    t: 0,               // アニメーションの進み（0..1）
    pending: null,      // タップ式のときの始点
    ghost: null,        // ドラッグ中の仮の矢印
    checked: false,     // ⑤を表示したか
    auto: false         // 自動モード（作図ステップを飛ばすフラグ）
  };

  const COLORS = {
    pos: '#0b6bcb', vel: '#12a150', dv: '#ff7a00',
    auto: '#c026d3', mine: '#ff7a00', pred: 'rgba(120,120,120,.75)'
  };

  function C(x, y) { const s = HG.view.scale; return { x: x * s, y: y * s }; }
  function pts() { return HG.drawing.pts(); }
  function isHodo() { return S.on && (S.step === 4 || S.step === 5); }
  function active() { return S.on; }

  /* ---------- スナップ ---------- */
  function snapThreshold() { return Math.max(18, HG.state.video.width * 0.045); }
  function snap(ox, oy) {
    const p = pts();
    let best = -1, bd = Infinity;
    p.forEach((f, k) => {
      const d = Math.hypot(f.x - ox, f.y - oy);
      if (d < bd) { bd = d; best = k; }
    });
    if (best < 0 || bd > snapThreshold()) return null;
    return { k: best, x: p[best].x, y: p[best].y };
  }

  /* ---------- 入力（タップ／ドラッグを同じ結果にする） ---------- */
  function handle(p) {
    if (!S.on) return;

    /* 自由測定の予測：矢印を1本描いたら作図へ進む */
    if (S.step === 0) {
      if (!p.dragged) { S.pending = { ox: p.ox, oy: p.oy }; done(); return; }
      const v = { dx: p.ox - p.from.ox, dy: p.oy - p.from.oy };
      if (Math.hypot(v.dx, v.dy) < 4) { hint('もう少し長く矢印を引いてください。'); return; }
      HG.prediction.setFreeVector(v);
      S.ghost = null;              // 予測の仮の矢印を残さない
      goto(1);
      return;
    }

    /* 基準点はタップ1回で決まる */
    if (S.step === 1 && !HG.state.drawing.origin) {
      const s = snap(p.ox, p.oy);
      HG.drawing.setOrigin(s ? s.x : p.ox, s ? s.y : p.oy);
      S.pending = null;
      done();
      return;
    }

    let from, to;
    if (p.dragged) {
      from = { ox: p.from.ox, oy: p.from.oy };
      to = { ox: p.ox, oy: p.oy };
    } else if (S.pending) {
      from = S.pending; to = { ox: p.ox, oy: p.oy }; S.pending = null;
    } else {
      S.pending = { ox: p.ox, oy: p.oy };   // 1回目のタップ＝始点
      done();
      return;
    }

    if (S.step === 1) putPosition(from, to);
    else if (S.step === 2) putVelocity(from, to);
    else if (S.step === 4) putDeltaV(from, to);
    done();
  }

  function preview(a, b) {
    if (!S.on) return;
    S.ghost = { from: { ox: a.ox, oy: a.oy }, to: { ox: b.ox, oy: b.oy } };
    HG.stage.render();
  }

  function hint(msg) { HG.dom.text('#drawHint', msg); }

  function putPosition(from, to) {
    const o = HG.state.drawing.origin;
    const s = snap(to.ox, to.oy);
    if (!s) { hint('黒点の近くで離してください。基準点から黒点へ矢印を引きます。'); return; }
    HG.drawing.putPosition(s.k, { dx: s.x - o.x, dy: s.y - o.y });
  }

  function putVelocity(from, to) {
    const a = snap(from.ox, from.oy), b = snap(to.ox, to.oy);
    if (!a || !b) { hint('黒点から黒点へ引いてください。'); return; }
    if (b.k - a.k !== 1) { hint('隣り合う点どうしを、番号の小さいほうから大きいほうへ結んでください。'); return; }
    HG.drawing.putVelocity(a.k, { dx: b.x - a.x, dy: b.y - a.y });
  }

  function putDeltaV(from, to) {
    /* ④はスナップなし。どの組の Δv かは、始点がどの先端に近いかで決める */
    const n = HG.drawing.counts().n;
    let best = -1, bd = Infinity;
    for (let k = 0; k < n - 2; k++) {
      if (!HG.hodo.visible(k) || !HG.hodo.visible(k + 1)) continue;
      const t = HG.hodo.tip(k);
      if (!t) continue;
      const d = Math.hypot(t.x - from.ox, t.y - from.oy);
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0 || bd > HG.state.video.width * 0.18) {
      hint('速度ベクトルの先端から、次の速度ベクトルの先端へ引いてください。');
      return;
    }
    HG.drawing.putDeltaV(best, HG.hodo.toDeltaV(from.ox, from.oy, to.ox, to.oy, best));
  }

  /* ---------- ステップ進行 ---------- */
  function done() { S.ghost = null; updateUI(); HG.stage.render(); }

  function complete(step) {
    const c = HG.drawing.counts();
    if (step === 1) return !!HG.state.drawing.origin && c.pos >= c.posNeed && c.posNeed > 0;
    if (step === 2) return c.vel >= c.velNeed && c.velNeed > 0;
    if (step === 3) return S.step > 3;
    if (step === 4) return c.dv >= c.dvNeed && c.dvNeed > 0;
    if (step === 5) return S.checked;
    return false;
  }

  /** 自動モードで、そのステップぶんのデータを埋める（別系統にしない） */
  function autoFill(step) {
    const p = pts();
    if (!p.length) return;
    if (step === 1) {
      if (!HG.state.drawing.origin) {
        /* 基準点は任意の点でよい。軌道の左下の外側に置くと矢印が重ならない */
        let minx = p[0].x, maxy = p[0].y;
        p.forEach(f => { minx = Math.min(minx, f.x); maxy = Math.max(maxy, f.y); });
        HG.drawing.setOrigin(
          Math.max(HG.state.video.width * 0.04, minx - HG.state.video.width * 0.14),
          Math.min(HG.state.video.height * 0.96, maxy + HG.state.video.height * 0.12));
      }
      HG.drawing.fillPositions();
    } else if (step === 2) {
      HG.drawing.fillVelocities();
    } else if (step >= 4) {
      for (let k = 0; k < p.length - 2; k++) {
        if (!HG.state.drawing.deltaVVectors[k]) {
          HG.drawing.putDeltaV(k, HG.drawing.autoDeltaV(k));
        }
      }
    }
  }

  /**
   * 「解説」＝この運動で何が起きるか。⑤に来るまで画面に出さない。
   * 先に読ませると、予測が予測でなくなる。
   */
  function updateReveal() {
    const p = HG.state.preset;
    const box = $('#revealBox');
    const show = S.on && S.step >= 5 && p && p.note;
    box.classList.toggle('hide', !show);
    if (show) {
      HG.dom.html('#revealBox',
        '<div class="reveal-title">解説：' + p.name + '</div>' +
        '<div class="sub">' + p.note + '</div>');
    }
  }

  function goto(step) {
    S.step = step;
    S.pending = null;
    if (S.auto) autoFill(step);
    S.fade = (step === 4 || step === 5) ? 0.86 : 0;
    HG.stage.setSource(HG.strobe.cache.ready ? HG.strobe.canvas() : null);
    updateUI();
    updateReveal();
    HG.stage.render();
  }

  /* ---------- ③ 集める（必ずアニメーションさせる） ---------- */
  /** 自動モードの「次へ」。手書きと同じ道を通る */
  function autoNext() {
    if (S.step === 1) goto(2);
    else if (S.step === 2) collect();          // ③
    else if (S.step === 4) check();            // ⑤
    else if (S.step === 5) goto(6);
    else if (S.step === 3) collect();
  }

  function collect() {
    /* 矢印がスーッと滑って原点に集まる1秒間の動きが、
       「ベクトルは平行移動しても同じもの」という自由ベクトルの概念
       そのものを見せる。パッと切り替わると別物が現れたようにしか見えない。 */
    S.step = 3; S.collecting = true; S.t = 0;
    const t0 = performance.now();
    updateUI();
    (function tick() {
      S.t = Math.min(1, (performance.now() - t0) / 1000);
      S.fade = 0.86 * S.t;
      HG.stage.render();
      if (S.t < 1) requestAnimationFrame(tick);
      else { S.collecting = false; goto(4); }
    })();
  }

  /* ---------- 描画 ---------- */
  function paintFade(ctx) {
    if (S.fade <= 0) return;
    ctx.save();
    ctx.fillStyle = 'rgba(246,247,249,' + S.fade + ')';
    ctx.fillRect(0, 0, HG.stage.canvas().width, HG.stage.canvas().height);
    ctx.restore();
  }

  function paint(ctx) {
    if (!S.on) return;
    if (S.collecting) { paintCollect(ctx); return; }
    if (S.step === 0) { paintGhost(ctx); return; }
    if (S.step === 1 || S.step === 2 || S.step === 6) paintTrack(ctx);
    if (S.step === 4 || S.step === 5) paintHodo(ctx);
    paintGhost(ctx);
  }

  /* ①②⑥：ストロボ画像の上 */
  function paintTrack(ctx) {
    const o = HG.state.drawing.origin;
    const d = HG.state.drawing;
    /* ⑥は「その位置で、この向き」を見る画面。①②の矢印を残すと
       画面が矢印だらけになって肝心の Δv が読めない */
    const showBuild = S.step !== 6;

    if (o && showBuild) {
      const c = C(o.x, o.y);
      ctx.save();
      ctx.fillStyle = '#12161c';
      ctx.beginPath(); ctx.arc(c.x, c.y, 5 * HG.view.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.font = (12 * HG.view.dpr) + 'px sans-serif';
      ctx.fillText('基準点', c.x + 8 * HG.view.dpr, c.y - 8 * HG.view.dpr);
      ctx.restore();

      d.positionVectors.forEach(v => {
        if (!v) return;
        const a = C(o.x, o.y), b = C(o.x + v.dx, o.y + v.dy);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.pos, width: 2, head: 8, alpha: 0.9 });
      });
    }

    if (S.step >= 2 && showBuild) {
      const p = pts();
      d.velocityVectors.forEach((v, k) => {
        if (!v || !p[k]) return;
        const a = C(p[k].x, p[k].y), b = C(p[k].x + v.dx, p[k].y + v.dy);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.vel, width: 3, head: 10 });
      });
    }

    if (S.step === 6) { paintPrediction(ctx, 'track'); paintBackDraw(ctx); }
  }

  /* ⑥ 加速度を軌道上へ描き戻す（この教材の到達点） */
  function paintBackDraw(ctx) {
    const p = pts(), d = HG.state.drawing;
    const lens = [];
    d.deltaVVectors.forEach(v => { if (v) lens.push(Math.hypot(v.dx, v.dy)); });
    if (!lens.length) return;
    lens.sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)] || 1;

    /* 等速運動では Δv がゼロになる。矢印が消えて何も表示されないのを避け、
       点と文字で明示する。ゼロベクトルもベクトルである、というのは
       ここでしか教えられない。 */
    const j = HG.selection.current().jitter;
    if (med < 3 * j) {
      d.deltaVVectors.forEach((v, i) => {
        if (!v) return;
        const at = p[HG.drawing.posIndexOfDeltaV(i)];
        if (!at) return;
        const c = C(at.x, at.y);
        const r = 9 * HG.view.dpr;
        ctx.save();
        ctx.strokeStyle = COLORS.dv;
        ctx.lineWidth = 2.5 * HG.view.dpr;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      });
      const first = p[HG.drawing.posIndexOfDeltaV(0)];
      if (first) {
        const c = C(first.x, first.y);
        ctx.save();
        ctx.font = (14 * HG.view.dpr) + 'px sans-serif';
        ctx.lineWidth = 3 * HG.view.dpr;
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.fillStyle = '#ff9a3c';
        const txt = 'Δv ≒ 0（ばらつき ±' + med.toFixed(1) + ' px）';
        ctx.strokeText(txt, c.x, c.y - 22 * HG.view.dpr);
        ctx.fillText(txt, c.x, c.y - 22 * HG.view.dpr);
        ctx.restore();
      }
      return;
    }
    /* 全部に同じ倍率を掛ける。長さの比を保たないと、
       「斜方投射は全部同じ長さ」「バネは離れるほど長い」が見えなくなる */
    const k = med > 1e-6 ? (HG.state.video.width * 0.13) / med : 0;

    d.deltaVVectors.forEach((v, i) => {
      if (!v) return;
      const at = p[HG.drawing.posIndexOfDeltaV(i)];   // 半コマずれ：r_i ではなく r_{i+1}
      if (!at) return;
      const a = C(at.x, at.y), b = C(at.x + v.dx * k, at.y + v.dy * k);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.dv, width: 3, head: 11 });
    });
  }

  /* ③ アニメーション：矢印が滑って原点に集まる */
  function paintCollect(ctx) {
    const p = pts(), t = S.t, n = HG.drawing.counts().n;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const s1 = HG.hodo.scale();
    for (let k = 0; k < n - 1; k++) {
      const v = HG.drawing.velocity(k);
      if (!v || !p[k]) continue;
      const o = HG.hodo.originFor(k);
      const tail = { x: p[k].x + (o.x - p[k].x) * ease, y: p[k].y + (o.y - p[k].y) * ease };
      const sc = 1 + (s1 - 1) * ease;
      const a = C(tail.x, tail.y), b = C(tail.x + v.dx * sc, tail.y + v.dy * sc);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.vel, width: 3, head: 10 });
    }
  }

  /* ④⑤：別枠（ホドグラフ） */
  function paintHodo(ctx) {
    HG.hodo.drawAxes(ctx);
    const n = HG.drawing.counts().n;
    const d = HG.state.drawing;

    /* ペア送りでは、送るたびに先端が薄い点として残る */
    if (HG.hodo.state.mode === 'pair') {
      for (let k = 0; k < n - 1; k++) {
        const t = HG.hodo.tip(k);
        if (!t) continue;
        const c = C(t.x, t.y);
        ctx.save();
        ctx.fillStyle = 'rgba(18,161,80,.28)';
        ctx.beginPath(); ctx.arc(c.x, c.y, 4 * HG.view.dpr, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    for (let k = 0; k < n - 1; k++) {
      if (!HG.hodo.visible(k)) continue;
      const v = HG.drawing.velocity(k), o = HG.hodo.originFor(k), s = HG.hodo.scale();
      if (!v) continue;
      const a = C(o.x, o.y), b = C(o.x + v.dx * s, o.y + v.dy * s);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.vel, width: 2.5, head: 9, alpha: 0.95 });
      const lbl = C(o.x + v.dx * s, o.y + v.dy * s);
      ctx.save();
      ctx.font = (11 * HG.view.dpr) + 'px ui-monospace,monospace';
      ctx.fillStyle = '#0a7a3c';
      ctx.fillText('v' + k, lbl.x + 5 * HG.view.dpr, lbl.y - 5 * HG.view.dpr);
      ctx.restore();
    }

    /* 生徒が描いた Δv */
    d.deltaVVectors.forEach((v, k) => {
      if (!v || !HG.hodo.visible(k) || !HG.hodo.visible(k + 1)) return;
      const t = HG.hodo.tip(k), e = HG.hodo.deltaVEnd(k, v);
      if (!t || !e) return;
      const a = C(t.x, t.y), b = C(e.x, e.y);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.mine, width: 3, head: 10 });
    });

    /* ⑤ 答え合わせ：自動算出を重ねて表示する。別画面にしない。
       ズレて見えること自体が議論の材料になる */
    if (S.step === 5) {
      for (let k = 0; k < n - 2; k++) {
        if (!HG.hodo.visible(k) || !HG.hodo.visible(k + 1)) continue;
        const ref = HG.drawing.autoDeltaV(k);
        const t = HG.hodo.tip(k), e = ref && HG.hodo.deltaVEnd(k, ref);
        if (!t || !e) continue;
        const a = C(t.x, t.y), b = C(e.x, e.y);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y,
          { color: COLORS.auto, width: 2, head: 9, dash: true, alpha: 0.95 });
      }
      paintPrediction(ctx, 'hodo');
    }

    if (S.step === 4) paintMini(ctx);
  }

  /**
   * 予測の矢印を薄い灰色で重ねる。逃げ場を無くすための表示。
   * 別枠では各 Δv の始点（速度ベクトルの先端）から、
   * 軌道では対応する点から、同じ長さで描く。
   */
  function paintPrediction(ctx, where) {
    const pr = HG.state.drawing.prediction;
    if (!pr || !HG.prediction.isEnabled()) return;
    const n = HG.drawing.counts().n;

    if (where === 'hodo') {
      for (let k = 0; k < n - 2; k++) {
        if (!HG.hodo.visible(k) || !HG.hodo.visible(k + 1)) continue;
        const t = HG.hodo.tip(k);
        const dir = HG.prediction.dirAt(HG.drawing.posIndexOfDeltaV(k));
        const ref = HG.drawing.autoDeltaV(k);
        if (!t || !ref) continue;
        const len = Math.hypot(ref.dx, ref.dy) * HG.hodo.scale();
        const a = C(t.x, t.y);
        if (!dir) { HG.arrows.dot(ctx, a.x, a.y, { color: COLORS.pred }); continue; }
        const b = C(t.x + dir.dx * len, t.y + dir.dy * len);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y,
          { color: COLORS.pred, width: 5, head: 12, alpha: 0.55 });
      }
      return;
    }

    /* 軌道の上（⑥）。描き戻した Δv と同じ長さで重ねる */
    const p = pts(), d = HG.state.drawing;
    const lens = [];
    d.deltaVVectors.forEach(v => { if (v) lens.push(Math.hypot(v.dx, v.dy)); });
    if (!lens.length) return;
    lens.sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)] || 1;
    const len = HG.state.video.width * 0.13;
    for (let k = 0; k < n - 2; k++) {
      const at = p[HG.drawing.posIndexOfDeltaV(k)];
      if (!at) continue;
      const dir = HG.prediction.dirAt(HG.drawing.posIndexOfDeltaV(k));
      const a = C(at.x, at.y);
      if (!dir) { HG.arrows.dot(ctx, a.x, a.y, { color: COLORS.pred }); continue; }
      const b = C(at.x + dir.dx * len, at.y + dir.dy * len);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y,
        { color: COLORS.pred, width: 6, head: 13, alpha: 0.5 });
    }
  }

  /**
   * ①②のミニ図。
   * ①②と③④はまったく同じ操作である（始点を揃える → 先端を結ぶ）。
   * 並べて置くと、「位置→速度」でやったことを一段上げると「速度→加速度」に
   * なる、と生徒が自分で気づける。微分の階層構造がここで入る。
   */
  function paintMini(ctx) {
    const p = pts(), o = HG.state.drawing.origin;
    if (!o || p.length < 2) return;
    const cw = HG.stage.canvas().width, ch = HG.stage.canvas().height;
    const box = Math.min(cw, ch) * 0.30;
    const x0 = cw - box - 8 * HG.view.dpr, y0 = 8 * HG.view.dpr;

    let minx = o.x, maxx = o.x, miny = o.y, maxy = o.y;
    p.forEach(f => {
      minx = Math.min(minx, f.x); maxx = Math.max(maxx, f.x);
      miny = Math.min(miny, f.y); maxy = Math.max(maxy, f.y);
    });
    const k = (box * 0.82) / Math.max(maxx - minx, maxy - miny, 1);
    const M = (x, y) => ({ x: x0 + box * 0.09 + (x - minx) * k, y: y0 + box * 0.09 + (y - miny) * k });

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.strokeStyle = 'rgba(0,0,0,.15)';
    ctx.lineWidth = 1 * HG.view.dpr;
    ctx.fillRect(x0, y0, box, box);
    ctx.strokeRect(x0, y0, box, box);
    ctx.font = (9 * HG.view.dpr) + 'px sans-serif';
    ctx.fillStyle = '#5b6572';
    ctx.fillText('①→② と同じ操作', x0 + 4 * HG.view.dpr, y0 + box - 5 * HG.view.dpr);

    const oc = M(o.x, o.y);
    p.forEach(f => {
      const c = M(f.x, f.y);
      HG.arrows.draw(ctx, oc.x, oc.y, c.x, c.y, { color: COLORS.pos, width: 1, head: 4, alpha: 0.55 });
    });
    for (let i = 0; i < p.length - 1; i++) {
      const a = M(p[i].x, p[i].y), b = M(p[i + 1].x, p[i + 1].y);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.vel, width: 1.6, head: 5 });
    }
    ctx.restore();
  }

  function paintGhost(ctx) {
    if (S.pending) {
      const c = C(S.pending.ox, S.pending.oy);
      ctx.save();
      ctx.strokeStyle = '#12161c'; ctx.lineWidth = 2 * HG.view.dpr;
      ctx.beginPath(); ctx.arc(c.x, c.y, 7 * HG.view.dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (!S.ghost) return;
    const a = C(S.ghost.from.ox, S.ghost.from.oy), b = C(S.ghost.to.ox, S.ghost.to.oy);
    HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: 'rgba(20,20,20,.5)', width: 2, head: 8, dash: true });
  }

  /* ---------- UI ---------- */
  const STEPS = [
    { id: 1, label: '① 位置', hint: '基準点をタップしてください。そこから各コマの黒点へ矢印を引きます。' },
    { id: 2, label: '② 速度', hint: '隣り合う位置ベクトルの先端どうし（＝隣の黒点どうし）を結んでください。これが速度ベクトルです。' },
    { id: 3, label: '③ 集める', hint: '「集める」を押すと、②で描いた速度ベクトルが共通の始点へ集まります。' },
    { id: 4, label: '④ Δv', hint: '隣り合う速度ベクトルの先端どうしを結んでください。これが Δv（加速度の向き）です。ここは磁石が効きません。' },
    { id: 5, label: '⑤ 答え合わせ', hint: '自動算出した Δv（紫の破線）を重ねました。ズレの理由を考えてみてください。' },
    { id: 6, label: '⑥ 描き戻す', hint: 'Δv を、対応するコマの黒点を始点にして軌道上へ描き戻しました。' }
  ];

  function updateUI() {
    const c = HG.drawing.counts();
    HG.dom.html('#stepChips', STEPS.map(s => {
      const back = S.on && s.id < S.step;      // 戻るのは自由。⑤⑥は何度でも見返してよい
      const cls = s.id === S.step ? 'chip-step now'
                : complete(s.id) ? 'chip-step ok' : 'chip-step';
      return '<span class="' + cls + (back ? ' back' : '') + '" data-step="' + s.id + '">' +
             s.label + '</span>';
    }).join(''));

    if (S.step === 0) {
      hint('解析する前に、加速度の矢印がどこを向くと思うか、画面の上に1本だけ引いてください。');
    }
    const st = STEPS[S.step - 1];
    if (st) {
      let extra = '';
      if (S.step === 1 && HG.state.drawing.origin) extra = '（' + c.pos + ' / ' + c.posNeed + ' 本）';
      if (S.step === 2) extra = '（' + c.vel + ' / ' + c.velNeed + ' 本）';
      if (S.step === 4) extra = '（' + c.dv + ' / ' + c.dvNeed + ' 本）';
      hint(st.hint + extra);
    }

    const show = (sel, on) => $(sel).classList.toggle('hide', !on);
    show('#startDraw', !S.on);
    show('#drawActions', S.on);
    show('#autoNext', S.on && S.auto && S.step < 6);
    show('#drawModeRow', !S.on);
    if (S.auto) {
      /* 自動モードでは作図の操作は出さない。表示するだけ */
      ['#fillRest', '#nextStep', '#collectBtn', '#checkBtn', '#backdrawBtn', '#drawUndo']
        .forEach(x => show(x, false));
      const st = STEPS[S.step - 1];
      if (st) hint((S.step === 3 ? '速度ベクトルを共通の始点へ集めています…' : st.hint.replace(/してください。?/g, 'しています。')));
      show('#hodoRow', S.step >= 4);
      show('#pairRow', S.step >= 4 && HG.hodo.state.mode === 'pair');
      show('#drawReset', true);
      show('#drawExit', true);
      return;
    }
    show('#fillRest', S.on && (S.step === 1 || S.step === 2) &&
         (S.step === 1 ? (HG.state.drawing.origin && c.pos >= Math.min(3, c.posNeed)) : c.vel >= Math.min(3, c.velNeed)));
    show('#nextStep', S.on && S.step <= 2 && complete(S.step));
    show('#collectBtn', S.on && S.step === 3);
    show('#checkBtn', S.on && S.step === 4 && complete(4));
    show('#backdrawBtn', S.on && S.step === 5);
    show('#hodoRow', S.on && S.step >= 4);
    show('#pairRow', S.on && S.step >= 4 && HG.hodo.state.mode === 'pair');
    show('#drawUndo', S.on && (S.step === 1 || S.step === 2 || S.step === 4));
    show('#drawReset', S.on);
    show('#drawExit', S.on);

    if (S.step >= 4) {
      const n = HG.drawing.counts().n;
      const sl = $('#pairSlider');
      sl.min = 0; sl.max = Math.max(0, n - 3); sl.value = HG.hodo.state.pair;
      HG.dom.text('#pairVal', 'v' + HG.hodo.state.pair + ' と v' + (HG.hodo.state.pair + 1));
    }
  }

  function start() {
    if (!HG.strobe.cache.ready) {
      if (!confirm('先にストロボ画像を作ると、全コマの点が1枚に並んで作図しやすくなります。このまま作図に進みますか？')) return;
    }
    if (HG.drawing.counts().n < 3) { alert('座標のあるコマが3点以上必要です。'); return; }
    S.on = true; S.checked = false;
    S.auto = ($('#drawMode').value === 'auto');
    document.body.classList.add('drawing');   // 作図中は他のカードを畳む
    const pred = HG.state.drawing.prediction;
    HG.drawing.reset();
    HG.state.drawing.prediction = pred;       // 予測は作図のやり直しでも残す
    HG.pointer.setHandler(handle);
    HG.pointer.setPreview(preview);
    const preset = HG.state.preset;
    const needFree = preset && preset.freeDraw && HG.prediction.isEnabled() &&
                     !S.auto && !HG.state.drawing.prediction;
    goto(needFree ? 0 : 1);
  }

  function stop() {
    S.on = false; S.fade = 0; S.ghost = null; S.pending = null;
    document.body.classList.remove('drawing');
    $('#revealBox').classList.add('hide');
    HG.controls.usePointHandler();
    HG.pointer.setPreview(null);
    HG.stage.setSource(HG.strobe.cache.ready ? HG.strobe.canvas() : null);
    updateUI();
    HG.stage.render();
  }

  /**
   * 予測が当たっていたかを、実際の Δv と比べて返す。
   * 自動モードでは生徒の作図が無いので、⑤の主役はこちらになる。
   * 「そう思ってた」と記憶を書き換えさせないための表示。
   */
  function predictionVerdict() {
    const pr = HG.state.drawing.prediction;
    if (!pr || !HG.prediction.isEnabled()) return '';
    const n = HG.drawing.counts().n;
    const byAnswer = {};
    for (let k = 0; k < n - 2; k++) {
      const i = HG.drawing.posIndexOfDeltaV(k);
      const a = HG.prediction.answerForPoint(i);
      const dir = HG.prediction.dirAt(i), ref = HG.drawing.autoDeltaV(k);
      if (!a || !ref) continue;
      const key = a.id + '\u0000' + a.label + '\u0000' + (a.q || '');
      if (!byAnswer[key]) byAnswer[key] = [];
      if (!dir) { byAnswer[key].push(null); continue; }   // 「ゼロ」を選んだ場合
      const l = Math.hypot(ref.dx, ref.dy);
      let c = (dir.dx * ref.dx + dir.dy * ref.dy) / l;
      c = Math.max(-1, Math.min(1, c));
      byAnswer[key].push(Math.acos(c) * 180 / Math.PI);
    }
    const rows = Object.keys(byAnswer).map(key => {
      const parts = key.split('\u0000');
      const vals = byAnswer[key].filter(v => v !== null);
      if (!vals.length) {
        return '予測 <b>' + parts[0] + '</b>（' + parts[1] + '）… ' +
          '<span class="warn">実際には Δv は 0 ではありませんでした</span>';
      }
      vals.sort((a, b) => a - b);
      const med = vals[Math.floor(vals.length / 2)];
      const ok = med <= 25;
      return '予測 <b>' + parts[0] + '</b>（' + parts[1] + '）… ' +
        (ok ? '<span class="ok">実際の Δv とほぼ同じ向きでした（ずれ ' + med.toFixed(0) + '°）</span>'
            : '<span class="warn">実際の Δv とは ' + med.toFixed(0) + '° 違いました</span>');
    });
    return rows.length
      ? '<div class="spaced-sm"><b>予測の答え合わせ</b></div>' + rows.join('<br>')
      : '';
  }

  function check() {
    S.checked = true;
    const n = HG.drawing.counts().n;
    const rows = [];
    let worst = 0, ok = 0, cnt = 0;
    for (let k = 0; k < n - 2; k++) {
      const e = HG.drawing.angleError(k);
      if (!e) continue;
      cnt++; if (e.ok) ok++;
      worst = Math.max(worst, e.deg);
      rows.push('Δv' + k + ' … ' + (e.ok ? '<span class="ok">向きは合っています</span>'
        : '<span class="warn">向きが ' + e.deg.toFixed(0) + '° ずれています</span>'));
    }
    /* 自動算出側にも測定のばらつきがある。それを黙って「正解」として
       突きつけないこと。ズレの原因が作図なのか素材なのかを分けて考えられる。 */
    const u = HG.selection.current().angle;
    const note = u > 8
      ? '<div class="warn spaced-sm">この素材では、自動算出した Δv の向き自体に ±' +
        u.toFixed(0) + '° の不確かさがあります。細かいズレは作図の失敗とは限りません。</div>'
      : '';
    const pred = predictionVerdict();
    if (S.auto) {
      /* 自動モードには生徒の作図が無い。⑤は予測との突き合わせが主役になる */
      HG.dom.html('#checkResult', pred ||
        '<div class="spaced-sm">自動算出した Δv（紫の破線）を表示しています。</div>');
    } else {
      HG.dom.html('#checkResult', (cnt
        ? '<div class="spaced-sm"><b>' + ok + ' / ' + cnt + ' 本が許容範囲（±15°）</b>' +
          '（最大のずれ ' + worst.toFixed(0) + '°）</div>' + note + rows.join('<br>')
        : '判定できませんでした。') + (pred ? '<div class="spaced">' + pred + '</div>' : ''));
    }
    goto(5);
  }

  function undo() {
    const d = HG.state.drawing;
    const arr = S.step === 1 ? d.positionVectors : S.step === 2 ? d.velocityVectors : d.deltaVVectors;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]) { arr[i] = undefined; break; }
    }
    if (S.step === 1 && !arr.some(v => v)) d.origin = null;
    done();
  }

  function attach() {
    $('#startDraw').onclick = start;
    $('#drawReset').onclick = () => { HG.drawing.reset(); S.checked = false; goto(1); };
    $('#drawUndo').onclick = undo;
    $('#drawExit').onclick = stop;
    $('#autoNext').onclick = autoNext;
    $('#drawMode').onchange = e => { S.auto = (e.target.value === 'auto'); };
    $('#nextStep').onclick = () => goto(S.step + 1);
    $('#collectBtn').onclick = collect;
    $('#checkBtn').onclick = check;
    $('#backdrawBtn').onclick = () => goto(6);
    $('#fillRest').onclick = () => {
      if (S.step === 1) HG.drawing.fillPositions();
      else HG.drawing.fillVelocities();
      done();
    };
    $('#stepChips').onclick = e => {
      const el = e.target.closest('[data-step]');
      if (!el || !S.on) return;
      const to = +el.dataset.step;
      if (to < S.step) goto(to);              // 前のステップへは自由に戻れる
    };
    $('#hodoMode').onchange = e => { HG.hodo.setMode(e.target.value); done(); };
    $('#pairSlider').oninput = e => { HG.hodo.setPair(+e.target.value); done(); };
    $('#hodoZoom').oninput = e => {
      HG.hodo.setZoom(+e.target.value / 10);
      HG.dom.text('#hodoZoomVal', '×' + (+e.target.value / 10).toFixed(1));
      done();
    };
    HG.bus.on('selection:changed', () => { if (S.on) stop(); });
    updateUI();
  }

  HG.draw = { attach, paint, paintFade, isHodo, active, state: S, start, stop };
})(window.HG = window.HG || {});
