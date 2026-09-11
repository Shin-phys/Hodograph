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
    auto: false,        // 自動モード（作図ステップを飛ばすフラグ）
    runAll: false,      // 自動モードで⑥まで止まらずに進む
    flying: -1,         // ⑥へ矢印が移動するアニメーション（0..1、-1 で停止）
    focusZoom: 1,       // 注目モードで三角形をまとめて拡大した倍率
    savedCrop: null,    // 別枠のあいだ預かっておくクロップ
    focus: -1           // 1点ずつ見るときの Δv 番号（-1 で全部）
  };

  /* ⑥で軌道の上に何を描くか。
     「別枠で作った Δv が、突然そこに現れる」ように見えるのを避けるため、
     既定で速度も一緒に出す。速度（接線）と Δv の関係がその場で読める。 */
  const L = { pos: false, vel: true, dv: true, pred: true };

  const COLORS = {
    pos: '#0b6bcb', vel: '#12a150', dv: '#ff7a00',
    auto: '#c026d3', mine: '#ff7a00', pred: 'rgba(120,120,120,.75)'
  };

  /* 座標変換は必ずここを通す。クロップ（軌道に合わせる）が入ると
     x * view.scale ではずれる */
  function C(x, y) { return HG.coords.toCanvas(x, y); }
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
    const from = S.step;
    S.step = step;
    S.pending = null;
    S.flying = -1;
    if (S.auto) autoFill(step);
    S.fade = (step === 4 || step === 5) ? 0.86 : 0;

    /* 別枠（④⑤）は抽象的な図なので、軌道に合わせたクロップの中に描くと
       横幅が足りない（一次元運動では特に）。別枠のあいだだけ全体表示に戻し、
       軌道に戻る⑥でクロップを復元する。 */
    if (step === 4 || step === 5) {
      if (HG.view.crop && !S.savedCrop) S.savedCrop = HG.view.crop;
      HG.coords.setCrop(null);
    } else if (S.savedCrop) {
      HG.coords.setCrop(S.savedCrop);
      S.savedCrop = null;
    }
    if (HG.controls.updateFitLabel) HG.controls.updateFitLabel();
    HG.stage.setSource(HG.strobe.cache.ready ? HG.strobe.canvas() : null, HG.strobe.cache.scale);
    updateUI();
    updateReveal();
    HG.stage.render();
    /* 別枠から軌道へ移るときだけ、矢印を滑らせる */
    if (step === 6 && (from === 4 || from === 5)) flyBack();
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

  /**
   * 自動描写モードの「一気に⑥まで」。
   *
   * ステップを飛ばすのではなく、手動の「次へ」を自分で押しているだけ。
   * ③の集めるアニメーションも⑥の飛び戻りもそのまま通るので、
   * 授業で提示したときに「どこから来た矢印なのか」が見える。
   * 別系統の描画を作ると、手書きモードと結果がずれる恐れがある。
   */
  function runToEnd() {
    S.runAll = true;
    let guard = 40;
    (function drive() {
      if (!S.on || !S.runAll) { S.runAll = false; return; }
      if (S.step >= 6) { S.runAll = false; updateUI(); return; }
      /* アニメーション中は待つ（途中で割り込むと矢印が飛ぶ）。
         ここで空回りするあいだは guard を減らさない。減らしてしまうと
         ③の1秒のアニメーションだけで回数を使い切り、④で止まる。 */
      if (S.collecting || S.flying >= 0) { requestAnimationFrame(drive); return; }
      if (guard-- <= 0) { S.runAll = false; updateUI(); return; }
      autoNext();
      setTimeout(drive, 80);
    })();
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
    const six = (S.step === 6);
    /* ⑥ではレイヤーで選ぶ。①②を全部残すと矢印だらけで Δv が読めないが、
       速度を消すと Δv が宙に浮いて見える。既定は「速度＋Δv」。 */
    const showPos = six ? (L.pos && S.focus < 0) : true;
    const showVel = six ? (L.vel && S.focus < 0) : (S.step >= 2);

    if (o && showPos) {
      const c = C(o.x, o.y);
      ctx.save();
      ctx.fillStyle = '#12161c';
      ctx.beginPath(); ctx.arc(c.x, c.y, 5 * HG.view.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.font = (12 * HG.view.dpr) + 'px sans-serif';
      ctx.fillText('基準点', c.x + 8 * HG.view.dpr, c.y - 8 * HG.view.dpr);
      ctx.restore();

      /* ①を描き終えたら薄くする。一次元運動では位置ベクトルと速度ベクトルが
         同じ直線に乗るので、同じ濃さだと②が描けない。 */
      const dim = (S.step >= 2);
      d.positionVectors.forEach(v => {
        if (!v) return;
        const a = C(o.x, o.y), b = C(o.x + v.dx, o.y + v.dy);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y,
          { color: COLORS.pos, width: dim ? 1.5 : 2, head: dim ? 6 : 8, alpha: dim ? 0.32 : 0.9 });
      });
    }

    if (showVel) {
      const p = pts();
      d.velocityVectors.forEach((v, k) => {
        if (!v || !p[k]) return;
        const a = C(p[k].x, p[k].y), b = C(p[k].x + v.dx, p[k].y + v.dy);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.vel, width: 3, head: 10 });
      });
    }

    if (six) {
      if (L.pred) paintPrediction(ctx, 'track');
      if (L.dv) paintBackDraw(ctx);
    }
  }

  /**
   * Δv を軌道に描くときの倍率。注目モードでは実寸（三角形が閉じる）。
   *
   * 長さの決め方を2つの上限のうち小さいほうにしてある。
   *
   *  (1) 見えている範囲の 13%
   *      元は「動画の横幅の 13%」だった。クロップして拡大すると、
   *      見えている範囲に対して矢印だけが相対的に長くなっていた。
   *
   *  (2) 隣り合う点の間隔の 1.3 倍
   *      これを超えると矢印が隣の矢印と交差して、どの点の矢印なのかが
   *      読めなくなる。単振り子のような**浅い弧**で決定的に効く。
   *      振り子の弧は横に長く縦に薄い（振れ角25°で高さは弦の1割程度）ので、
   *      (1) だけだと矢印が弧の高さの3倍になり、矢印同士が重なった。
   */
  function backScale() {
    if (S.focus >= 0) return 1;
    const lens = [];
    HG.state.drawing.deltaVVectors.forEach(v => { if (v) lens.push(Math.hypot(v.dx, v.dy)); });
    if (!lens.length) return 0;
    lens.sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)] || 1;
    if (med <= 1e-6) return 0;

    const byArea = HG.coords.area().w * 0.13;
    const p = pts();
    const gaps = [];
    for (let i = 0; i < p.length - 1; i++) {
      gaps.push(Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y));
    }
    gaps.sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const target = gap > 0 ? Math.min(byArea, gap * 1.3) : byArea;
    return target / med;
  }

  /**
   * ⑥ 1点だけを見る。
   *
   * 別枠で作った Δv をいきなり軌道に置くと、「突然そこに現れた矢印」に
   * 見えてしまう。そこで軌道の上でもう一度 Δv を作図する：
   *   ・r_k にあった速度を r_{k+1} へ平行移動して置き（破線）
   *   ・r_{k+1} の速度を並べ
   *   ・先端どうしを結ぶ → それが Δv
   *   ・同じ矢印を点を始点に平行移動 → これが描き戻し
   * ③でやった「始点をそろえる」を軌道の上で繰り返すだけなので、
   * 別枠と軌道が同じ操作でつながる。円運動なら、この三角形の閉じる辺が
   * 中心を向く。
   */
  /**
   * 三角形をまとめて拡大する倍率。
   * 速度も Δv も同じ倍率で伸ばすので、三角形の形と向きは変わらない（相似）。
   * Δv だけを伸ばすと三角形が閉じなくなり、作図としては嘘になる。
   */
  function focusScale(vb, va, dv) {
    const W = HG.state.video.width;
    const lv = Math.max(Math.hypot(vb.dx, vb.dy), Math.hypot(va.dx, va.dy));
    const ld = Math.hypot(dv.dx, dv.dy);
    if (lv < 1e-6) return 1;
    const wantDv = ld > 1e-6 ? (W * 0.11) / ld : Infinity;   // Δv を読める長さに
    const capV = (W * 0.42) / lv;                            // 速度が画面をはみ出さない範囲で
    return Math.max(1, Math.min(wantDv, capV));
  }

  function paintFocus(ctx, i) {
    const p = pts();
    const at = p[i + 1], from = p[i];
    const vb0 = HG.drawing.velocity(i), va0 = HG.drawing.velocity(i + 1);
    const dv0 = HG.state.drawing.deltaVVectors[i] || HG.drawing.autoDeltaV(i);
    if (!at || !from || !vb0 || !va0 || !dv0) return;

    const z = focusScale(vb0, va0, dv0);
    S.focusZoom = z;
    const vb = { dx: vb0.dx * z, dy: vb0.dy * z };
    const va = { dx: va0.dx * z, dy: va0.dy * z };
    const dv = { dx: dv0.dx * z, dy: dv0.dy * z };

    const A = C(at.x, at.y);
    const Tb = C(at.x + vb.dx, at.y + vb.dy);     // 平行移動した v_before の先端
    const Ta = C(at.x + va.dx, at.y + va.dy);     // v_after の先端

    /* もとの場所にあった v_before と、それをこの点へ持ってきたことを示す点線。
       「同じ矢印を平行移動しただけ」が見えないと、③でやったことと
       つながらない。 */
    const F = C(from.x, from.y), Fb = C(from.x + vb.dx, from.y + vb.dy);
    HG.arrows.draw(ctx, F.x, F.y, Fb.x, Fb.y, { color: COLORS.vel, width: 2, head: 8, alpha: 0.45 });
    ctx.save();
    ctx.strokeStyle = 'rgba(18,161,80,.45)';
    ctx.lineWidth = 1.5 * HG.view.dpr;
    ctx.setLineDash([3 * HG.view.dpr, 4 * HG.view.dpr]);
    ctx.beginPath(); ctx.moveTo(F.x, F.y); ctx.lineTo(A.x, A.y);
    ctx.moveTo(Fb.x, Fb.y); ctx.lineTo(Tb.x, Tb.y);
    ctx.stroke();
    ctx.restore();

    // r_{k+1} へ平行移動した v_before（破線）と、そこでの v_after
    HG.arrows.draw(ctx, A.x, A.y, Tb.x, Tb.y, { color: COLORS.vel, width: 2, head: 8, dash: true, alpha: 0.85 });
    HG.arrows.draw(ctx, A.x, A.y, Ta.x, Ta.y, { color: COLORS.vel, width: 3, head: 10 });

    // 先端どうしを結ぶ＝Δv（実寸）
    HG.arrows.draw(ctx, Tb.x, Tb.y, Ta.x, Ta.y, { color: COLORS.dv, width: 3, head: 10 });

    // 同じ矢印を点を始点に平行移動＝描き戻し
    const B = C(at.x + dv.dx, at.y + dv.dy);
    HG.arrows.draw(ctx, A.x, A.y, B.x, B.y, { color: COLORS.dv, width: 3.5, head: 11, alpha: 0.95 });

    ctx.save();
    ctx.font = (12 * HG.view.dpr) + 'px sans-serif';
    ctx.lineWidth = 3 * HG.view.dpr;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.fillStyle = '#ff9a3c';
    const mid = { x: (Tb.x + Ta.x) / 2, y: (Tb.y + Ta.y) / 2 };
    const away = { x: mid.x - A.x, y: mid.y - A.y };
    const al = Math.hypot(away.x, away.y) || 1;
    const lx = mid.x + away.x / al * 16 * HG.view.dpr;
    const ly = mid.y + away.y / al * 16 * HG.view.dpr;
    ctx.textAlign = 'center';
    ctx.strokeText('この2本の差 ＝ Δv', lx, ly);
    ctx.fillText('この2本の差 ＝ Δv', lx, ly);
    ctx.restore();
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
    if (S.focus >= 0) { paintFocus(ctx, S.focus); return; }

    /* 全部に同じ倍率を掛ける。長さの比を保たないと、
       「斜方投射は全部同じ長さ」「バネは離れるほど長い」が見えなくなる */
    const k = backScale();
    const fly = S.flying;                      // 0..1 のあいだは別枠から飛んでくる途中
    const hs = HG.hodo.scale();
    const ease = fly < 0 ? 1 : (fly < 0.5 ? 2 * fly * fly : 1 - Math.pow(-2 * fly + 2, 2) / 2);

    d.deltaVVectors.forEach((v, i) => {
      if (!v) return;
      const at = p[HG.drawing.posIndexOfDeltaV(i)];   // 半コマずれ：r_i ではなく r_{i+1}
      if (!at) return;
      let tail = at, sc = k;
      if (fly >= 0) {
        /* 別枠で Δv が始まっていた場所（速度ベクトルの先端）から、
           軌道上の対応する点まで滑らせる。③の「集める」の逆再生。 */
        const t0 = HG.hodo.tip(i);
        if (t0) {
          tail = { x: t0.x + (at.x - t0.x) * ease, y: t0.y + (at.y - t0.y) * ease };
          sc = hs + (k - hs) * ease;
        }
      }
      const a = C(tail.x, tail.y), b = C(tail.x + v.dx * sc, tail.y + v.dy * sc);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.dv, width: 3, head: 11 });
    });
  }

  /** ⑤→⑥ で、別枠の Δv が軌道の上へ滑って移動する */
  function flyBack() {
    S.flying = 0;
    const t0 = performance.now();
    (function tick() {
      const t = Math.min(1, (performance.now() - t0) / 900);
      S.flying = t;
      S.fade = 0.80 * (1 - t);
      HG.stage.render();
      if (t < 1) requestAnimationFrame(tick);
      else { S.flying = -1; S.fade = 0; HG.stage.render(); }
    })();
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

    /* 生徒が描いた Δv。
       階段モードでは「先端どうしを結んだ線」に段差が乗っていて、
       そのままでは向きが斜めに見える（自由落下なら本当は鉛直）。
       斜めの線は補助線（細い破線）にして、段差を引いた本当の Δv を実線で描く。 */
    const stairGap = HG.hodo.stairGap();
    d.deltaVVectors.forEach((v, k) => {
      if (!v || !HG.hodo.visible(k) || !HG.hodo.visible(k + 1)) return;
      const t = HG.hodo.tip(k);
      if (!t) return;
      const a = C(t.x, t.y);
      if (stairGap > 0.5) {
        const e = HG.hodo.deltaVEnd(k, v);          // 見かけ（段差込み）
        if (e) {
          const b = C(e.x, e.y);
          HG.arrows.draw(ctx, a.x, a.y, b.x, b.y,
            { color: 'rgba(120,130,140,.85)', width: 1.5, head: 7, dash: true });
        }
      }
      const tr = HG.hodo.deltaVTrue(k, v);          // 本当の Δv
      if (tr) {
        const b = C(tr.x, tr.y);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: COLORS.mine, width: 3, head: 10 });
      }
    });

    /* ⑤ 答え合わせ：自動算出を重ねて表示する。別画面にしない。
       ズレて見えること自体が議論の材料になる */
    if (S.step === 5) {
      for (let k = 0; k < n - 2; k++) {
        if (!HG.hodo.visible(k) || !HG.hodo.visible(k + 1)) continue;
        const ref = HG.drawing.autoDeltaV(k);
        const t = HG.hodo.tip(k), e = ref && HG.hodo.deltaVTrue(k, ref);
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
      if (S.focus >= 0 && k !== S.focus) continue;
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
    updateAutoPanel();
    if (S.auto) {
      /* 自動モードでは作図の操作は出さない。表示するだけ */
      ['#fillRest', '#nextStep', '#collectBtn', '#checkBtn', '#backdrawBtn', '#drawUndo']
        .forEach(x => show(x, false));
      const st = STEPS[S.step - 1];
      if (st) hint((S.step === 3 ? '速度ベクトルを共通の始点へ集めています…' : st.hint.replace(/してください。?/g, 'しています。')));
      show('#hodoRow', S.step >= 4 && S.step !== 6);
      show('#pairRow', S.step >= 4 && S.step !== 6 && HG.hodo.state.mode === 'pair');
      show('#gapRow', S.step >= 4 && S.step !== 6 && HG.hodo.state.mode === 'stair');
      show('#layerRow', S.step === 6);
      show('#focusRow', S.step === 6 && S.focus >= 0);
      if (S.step === 6) updateScaleNote();
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
    show('#hodoRow', S.on && S.step >= 4 && S.step !== 6);
    show('#layerRow', S.on && S.step === 6);
    show('#focusRow', S.on && S.step === 6 && S.focus >= 0);
    if (S.step === 6) updateScaleNote();
    show('#pairRow', S.on && S.step >= 4 && HG.hodo.state.mode === 'pair');
    show('#gapRow', S.on && S.step >= 4 && S.step !== 6 && HG.hodo.state.mode === 'stair');
    show('#drawUndo', S.on && (S.step === 1 || S.step === 2 || S.step === 4));
    show('#drawReset', S.on);
    show('#drawExit', S.on);

    if (S.step >= 4) {
      const n = HG.drawing.counts().n;
      const sl = $('#pairSlider');
      sl.min = 0; sl.max = Math.max(0, n - 3); sl.value = HG.hodo.state.pair;
      HG.dom.text('#pairVal', 'v' + HG.hodo.state.pair + ' と v' + (HG.hodo.state.pair + 1));
      const fs = $('#focusSlider');
      fs.min = 0; fs.max = Math.max(0, n - 3);
      if (S.focus >= 0) {
        fs.value = S.focus;
        HG.dom.text('#focusVal', '点 ' + HG.drawing.posIndexOfDeltaV(S.focus));
      }
    }
  }

  /** Δv を実寸で描いているのか、伸ばしているのかを必ず書く */
  function updateScaleNote() {
    if (S.focus >= 0) {
      HG.dom.text('#focusVal', '点 ' + HG.drawing.posIndexOfDeltaV(S.focus));
      $('#focusSlider').value = S.focus;
      const z = S.focusZoom || 1;
      HG.dom.text('#scaleNote',
        '速度も Δv も同じ ×' + z.toFixed(1) + ' で拡大しています。' +
        '三角形の形と向きはそのままなので、閉じる辺がそのまま Δv です。');
      return;
    }
    const k = backScale();
    let txt = k > 0
      ? 'Δv は見やすさのため ×' + k.toFixed(0) + ' に伸ばしています（速度ベクトルは実寸）。'
      : '';
    /* 折り返しの点は「速度がほぼゼロなのに Δv は最大」になる。
       このアプリの主題そのものなので、結果が出たここで名指しする。
       ⑥より前には出さない（先に言うと予測が予測でなくなる）。 */
    const tp = HG.selection.turningPoint();
    if (tp && !tp.atEdge) {
      const dv = HG.state.drawing.deltaVVectors;
      const kk = tp.index - 1;                    // 位置 r_{k+1} に対応する Δv は k = index-1
      const v = dv[kk];
      if (v) {
        const lens = dv.filter(a => a).map(a => Math.hypot(a.dx, a.dy)).sort((a, b) => a - b);
        const here = Math.hypot(v.dx, v.dy);
        const med = lens[Math.floor(lens.length / 2)] || 1;
        if (here >= med) {
          txt += (txt ? '<br>' : '') +
            '<b>点 ' + tp.index + ' は速さが ' + tp.speed.toFixed(1) + ' px（ほかの点の ' +
            Math.round(100 * tp.speed / tp.medSpeed) + ' %）しかありません。' +
            'それでも Δv はこの区間で最も長いほうです。</b>';
        }
      }
    }
    HG.dom.html('#scaleNote', txt);
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
    /* 自動描写モードでは表示を軌道に合わせておく。
       手書きなら生徒が自分で押すが、自動では誰も押さないまま⑥まで行ってしまう。
       単振り子のように横長で浅い軌道だと、素のままでは矢印が数ピクセルになる。 */
    if (S.auto && !HG.view.crop) {
      try { HG.controls.fitToTrack(); } catch (e) { /* 点が少ないときは何もしない */ }
    }
    goto(needFree ? 0 : 1);
    /* 自動描写モードで「一気に進む」なら、そのまま⑥まで通す */
    if (S.auto && $('#autoRunAll').checked && !needFree) runToEnd();
  }

  function stop() {
    S.on = false; S.fade = 0; S.ghost = null; S.pending = null;
    S.runAll = false;
    S.focus = -1; S.flying = -1;
    if (S.savedCrop) { HG.coords.setCrop(S.savedCrop); S.savedCrop = null; }
    document.body.classList.remove('drawing');
    $('#revealBox').classList.add('hide');
    HG.controls.usePointHandler();
    HG.pointer.setPreview(null);
    HG.stage.setSource(HG.strobe.cache.ready ? HG.strobe.canvas() : null, HG.strobe.cache.scale);
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


  /* ---------- 自動描写モードのパネル ----------
     「気軽に撮って加速度の向きを見る」ための入口。
     このモードでは生徒の作図が無いぶん、素材の粗さがそのまま矢印に出る。
     Δv は二階差分なので、座標のばらつきを3倍近くに増幅する。

     効くのは間隔を広げることで、ここが効率が良い。
     間隔を n 倍にすると Δv は n² 倍になるのに、ジッタは変わらない。
     つまり 2 倍に広げるだけで向きの精度は 4 倍になる。
     （平滑化でも似たことはできるが、衝突やばねのように加速度が
       急に変わる運動では本物の変化まで鈍らせてしまうので採らない。） */
  function updateAutoPanel() {
    const toggle = (sel, on) => { const el = $(sel); if (el) el.classList.toggle('hide', !on); };
    const isAuto = ($('#drawMode').value === 'auto');
    toggle('#autoSetupRow', !S.on && isAuto);
    if (S.on || !isAuto) return;

    const box = $('#autoQuality'), btn = $('#autoWiden');
    if (HG.drawing.counts().n < 3 || !HG.selection.isActive()) {
      HG.dom.html('#autoQuality', '先に追跡（または手動打点）と、使うコマの決定をしてください。');
      btn.classList.add('hide');
      return;
    }
    const cur = HG.selection.current();
    const g = HG.selection.suggest();
    const now = HG.state.selection.interval;

    /* しきい値は甘めに取ってある。荒れるコマの見積もりは
       安全側（実測よりも悪く出る）なので、そのまま警告にすると鳴りすぎる。 */
    const verdict = cur.angleWorst <= 25
      ? '<span class="ok">この間隔なら向きは読めます。</span>'
      : cur.angleWorst <= 60
        ? '<span class="warn">おおむね読めますが、ブレの大きいコマでは矢印が斜めに転ぶことがあります。</span>'
        : '<span class="warn">この素材とこの間隔では、矢印が逆を向くことがあります。間隔を広げてください。</span>';

    HG.dom.html('#autoQuality',
      'いまの ' + now + ' コマおき：加速度の向きの不確かさ <b>±' + cur.angle.toFixed(0) +
      '°</b>（荒れるコマで ±' + cur.angleWorst.toFixed(0) + '°）<br>' + verdict);

    /* 折り返し点が区間の端にあると、いちばん見せたい矢印だけが出ない。
       これも間隔では直らない。トリムの問題。 */
    const tp = HG.selection.turningPoint();
    if (tp && tp.atEdge) {
      HG.dom.html('#autoQuality', $('#autoQuality').innerHTML +
        '<br><span class="warn">折り返し点が区間のいちばん端にあります。</span>' +
        'Δv は前後の速度から作るので、区間の端には矢印が出ません。' +
        '<b>折り返しの少し手前から、反対の端の少し先まで</b>トリムしてください。');
    }

    /* 往復運動を1周期ぶん選んでいると、矢印が同じ場所に2本ずつ重なる。
       これは間隔では直らない。トリムの問題なので、そう言う。 */
    const rv = HG.selection.revisits();
    if (rv.ratio > 0.3) {
      HG.dom.html('#autoQuality', $('#autoQuality').innerHTML +
        '<br><span class="warn">同じ場所を通り直しています（' + rv.revisit + ' 点）。</span>' +
        'このままだと行きと帰りの矢印が同じ位置に重なります。' +
        '<b>1往復（1周）より短く</b>トリムしてください。' +
        '振り子やバネなら端から端まで、円運動なら1周の半分ほどが読みやすい範囲です。');
    }

    if (g.interval > now) {
      btn.classList.remove('hide');
      btn.textContent = '間隔を ' + g.interval + ' コマおきに広げる（±' +
                        g.angleWorst.toFixed(0) + '° になります）';
    } else {
      btn.classList.add('hide');
    }
  }

  function attach() {
    $('#startDraw').onclick = start;
    $('#drawReset').onclick = () => { HG.drawing.reset(); S.checked = false; goto(1); };
    $('#drawUndo').onclick = undo;
    $('#drawExit').onclick = stop;
    $('#autoNext').onclick = autoNext;
    $('#drawMode').onchange = e => { S.auto = (e.target.value === 'auto'); updateAutoPanel(); };
    $('#autoWiden').onclick = () => {
      HG.selection.setInterval(HG.selection.suggest().interval);
      updateAutoPanel();
    };
    HG.bus.on('selection:changed', updateAutoPanel);
    HG.bus.on('points:changed', updateAutoPanel);
    HG.bus.on('quality:changed', updateAutoPanel);
    updateAutoPanel();
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
    ['pos', 'vel', 'dv', 'pred'].forEach(key => {
      const id = '#ly' + key.charAt(0).toUpperCase() + key.slice(1);
      $(id).onchange = e => { L[key] = e.target.checked; HG.stage.render(); };
    });
    $('#focusOn').onchange = e => {
      /* ④のペア送りで見ていた組をそのまま引き継ぐ */
      S.focus = e.target.checked ? HG.hodo.state.pair : -1;
      done();
    };
    $('#focusSlider').oninput = e => { S.focus = +e.target.value; done(); };
    $('#hodoGap').oninput = e => {
      HG.hodo.setGap(+e.target.value / 100);
      HG.dom.text('#hodoGapVal', e.target.value + ' %');
      done();
    };
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
