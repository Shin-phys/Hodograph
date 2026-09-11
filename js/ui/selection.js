/* =====================================================================
   ui/selection.js — 使うコマの選択（等間隔を強制する）

   自由なコマ選択にはしない。Δt が不揃いになった瞬間に速度も加速度も
   すべて破綻するため。

   ★ つまみは「何コマおきに使うか」の1本だけ ★
   使う範囲はトリムで決まっているので、残る自由度は間隔だけでよい。
   点の数は「区間 ÷ 間隔」で決まる（上限あり）。
     間隔を狭める → 点が増える
     間隔を広げる → 点が減る
   以前は「間隔 × 個数 = 使う時間の長さ」という掛け算だったため、
   間隔を1にしても点が増えず、同じ点数が狭い範囲に密集していた。
   直感と逆で、実際に使ってもらって分からないと言われた設計。

   区間の末尾に出る端数は**捨てる**。最後の1区間だけ短くすると Δt が
   不揃いになり、その1点のために前後3本の Δv が壊れる。捨てたことは
   「余り◯コマは使いません」と必ず表示する（黙って切ると不具合に見える）。
   端数を前に出したいときは「開始をずらす」で 0〜間隔-1 の範囲で動かす。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  let active = false;

  function sel() { return HG.state.selection; }
  function trimRange() {
    const fr = HG.state.frames;
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);
    return { lo: inI, hi: Math.max(inI, outI) };
  }

  /**
   * 選ばれたコマ。
   * 座標が1つも無いときは座標なしのまま返す。ストロボ画像（中央値背景＋差分）は
   * 「動いた」という事実だけで作れるので、追跡できない対象でも通せるようにする。
   */
  function list() {
    const s = sel(), fr = HG.state.frames;
    if (!fr.length) return [];
    const anyFound = fr.some(f => f.found);
    const g = trimRange();
    const out = [];
    for (let i = s.startIndex; i <= g.hi; i += s.interval) {
      if (i < 0 || i >= fr.length) break;
      if (out.length >= s.count) break;          // 点が多すぎるとストロボが潰れる
      const f = fr[i];
      if (f && (f.found || !anyFound)) out.push(f);
    }
    return out;
  }

  /** 末尾に余ったコマ数（使われない分） */
  function leftover() {
    const s = sel(), g = trimRange();
    const pts = list();
    if (!pts.length) return 0;
    const last = s.startIndex + (Math.max(1, pts.length) - 1) * s.interval;
    return Math.max(0, g.hi - last);
  }

  function isActive() { return active; }

  /**
   * 座標のばらつき（ジッタ）の目安。
   * 間隔1コマの二階差分は、なめらかな運動ならほぼノイズなので、
   * その中央値をジッタの代わりに使う。
   */
  function jitter() {
    const f = HG.points.listInTrim();
    if (f.length < 3) return 0.3;
    const v = [];
    for (let i = 1; i < f.length - 1; i++) {
      v.push(Math.hypot(f[i + 1].x - 2 * f[i].x + f[i - 1].x,
                        f[i + 1].y - 2 * f[i].y + f[i - 1].y));
    }
    v.sort((a, b) => a - b);
    return Math.max(0.2, v[Math.floor(v.length / 2)] / 2);
  }

  /**
   * Δv の向きの不確かさ（度）。
   * Δv は二階差分なので、座標の誤差 σ に対して Δv の誤差はおよそ √6σ ≒ 2.4σ。
   * その横ずれが角度の誤差になるので atan(2.4σ / |Δv|)。
   * この角度こそ、このアプリで生徒が見る量（矢印の向き）の精度そのもの。
   */
  function angleUncertainty(dvLen, j) {
    if (!dvLen) return 90;
    return Math.atan2(2.4 * j, dvLen) * 180 / Math.PI;
  }

  const TARGET_ANGLE = 12;   // これ以下に収まる最小の間隔を推奨する

  /**
   * 推奨間隔。条件は2つあり、厳しいほうを採る。
   *  (1) コマ間の変位がジッタの 10 倍以上     … 速度が読めるための条件
   *  (2) Δv の向きの不確かさが 12°以下        … 加速度の向きが読めるための条件
   */
  function suggest() {
    const f = HG.points.listInTrim();
    const j = jitter();
    if (f.length < 4) return { interval: 1, ratio: 0, accRatio: 0, jitter: j, angle: 90 };
    const median = a => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)] || 0; };

    let firstOk1 = null;
    for (let m = 1; m <= Math.min(30, Math.floor(f.length / 3)); m++) {
      const disp = [], acc = [];
      for (let i = 0; i + m < f.length; i++) {
        disp.push(Math.hypot(f[i + m].x - f[i].x, f[i + m].y - f[i].y));
      }
      for (let i = m; i + m < f.length; i++) {
        acc.push(Math.hypot(f[i + m].x - 2 * f[i].x + f[i - m].x,
                            f[i + m].y - 2 * f[i].y + f[i - m].y));
      }
      const dMed = median(disp), aMed = median(acc);
      const interval = (f[m].index - f[0].index) || m;
      const r = {
        interval: interval, ratio: dMed / j, accRatio: aMed / j, jitter: j,
        angle: angleUncertainty(aMed, j), accWeak: false
      };
      if (dMed >= 10 * j && !firstOk1) firstOk1 = r;
      if (dMed >= 10 * j && r.angle <= TARGET_ANGLE) return r;
    }
    if (firstOk1) { firstOk1.accWeak = true; return firstOk1; }
    return { interval: 1, ratio: 0, accRatio: 0, jitter: j, angle: 90, accWeak: true };
  }

  /** いま選んでいる間隔での Δv の大きさと角度不確かさ */
  function current() {
    const p = list().filter(f => f.found);
    const j = jitter();
    if (p.length < 3) return { dv: 0, angle: 90, jitter: j };
    const a = [];
    for (let i = 1; i < p.length - 1; i++) {
      a.push(Math.hypot(p[i + 1].x - 2 * p[i].x + p[i - 1].x,
                        p[i + 1].y - 2 * p[i].y + p[i - 1].y));
    }
    a.sort((x, y) => x - y);
    const med = a[Math.floor(a.length / 2)] || 0;
    return { dv: med, angle: angleUncertainty(med, j), jitter: j };
  }

  /* ---------- 加速度プレビュー（stage の painter） ---------- */
  /* 既定で切ってある。教師が授業前に間隔を決めるための表示で、
     生徒に見せると作図の前に答えが出てしまう。 */
  let preview = false;

  function drawPreview(ctx) {
    if (!active || !preview) return;
    if (HG.draw && HG.draw.active()) return;
    const s = list().filter(f => f.found);
    if (s.length < 3) return;
    const strobe = HG.stage.mode() === 'strobe';
    const at = f => strobe ? { x: f.x, y: f.y } : { x: f.rawX, y: f.rawY };
    const pos = f => { const q = at(f); return HG.coords.toCanvas(q.x, q.y); };

    const dv = [];
    for (let i = 1; i < s.length - 1; i++) {
      dv.push({
        at: s[i],
        dx: (s[i + 1].x - s[i].x) - (s[i].x - s[i - 1].x),
        dy: (s[i + 1].y - s[i].y) - (s[i].y - s[i - 1].y)
      });
    }
    const lens = dv.map(d => Math.hypot(d.dx, d.dy)).sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)] || 0;
    const j = jitter();

    if (med < 3 * j) {
      dv.forEach(d => { const p = pos(d.at); HG.arrows.dot(ctx, p.x, p.y, { color: '#ff7a00' }); });
      const p0 = pos(dv[0].at);
      ctx.save();
      ctx.font = (13 * HG.view.dpr) + 'px sans-serif';
      ctx.lineWidth = 3 * HG.view.dpr;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.fillStyle = '#ff9a3c';
      const txt = 'Δv ≒ 0（ばらつき ±' + med.toFixed(1) + ' px）';
      ctx.strokeText(txt, p0.x, p0.y - 18 * HG.view.dpr);
      ctx.fillText(txt, p0.x, p0.y - 18 * HG.view.dpr);
      ctx.restore();
      return;
    }

    const target = HG.state.video.width * 0.10;
    const k = target / med;
    dv.forEach(d => {
      const q = at(d.at);
      const a = HG.coords.toCanvas(q.x, q.y);
      const b = HG.coords.toCanvas(q.x + d.dx * k, q.y + d.dy * k);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y,
        { color: '#ff7a00', width: 2.5, head: 10, alpha: 0.95 });
    });
  }

  /* ---------- UI ---------- */
  function clampToTrim() {
    const s = sel(), g = trimRange();
    if (s.interval < 1) s.interval = 1;
    if (s.offset === undefined) s.offset = 0;
    s.offset = Math.max(0, Math.min(s.interval - 1, s.offset));
    s.startIndex = g.lo + s.offset;

    $('#selInterval').value = s.interval;
    const off = $('#selOffset');
    off.min = 0; off.max = Math.max(0, s.interval - 1); off.value = s.offset;
    off.disabled = (s.interval <= 1);
    $('#selCount').value = s.count;
  }

  function refreshLabels() {
    const s = sel(), g = trimRange();
    HG.dom.text('#selIntervalVal', s.interval + ' コマおき');
    HG.dom.text('#selOffsetVal', s.offset + ' コマ');
    HG.dom.text('#selCountVal', s.count + ' 点');

    const p = list();
    const span = g.hi - g.lo + 1;
    const rest = leftover();
    const dt = p.length > 1 ? (p[1].t - p[0].t) : 0;
    const capped = (p.length >= s.count);
    HG.dom.text('#selInfo', p.length
      ? '区間 ' + span + ' コマ／' + s.interval + ' コマおき → ' + p.length + ' 点' +
        (capped ? '（上限で打ち切り。残り ' + rest + ' コマは未使用）'
                : rest ? '（余り ' + rest + ' コマは使いません）' : '') +
        '／点の間隔 ' + (dt * 1000).toFixed(0) + ' ms'
      : '座標のあるコマがありません。先に追跡か手動打点をしてください。');
  }

  function apply() {
    clampToTrim();
    refreshLabels();
    active = true;
    if (userTouched) showSuggestion();
    HG.refresh();
    HG.bus.emit('selection:changed');
  }

  /** スライダから指を離したとき（ここでストロボを作り直す） */
  function commit() {
    apply();
    HG.bus.emit('selection:committed');
  }

  let userTouched = false;
  function showSuggestion() {
    const f = HG.points.listInTrim();
    if (f.length < 4) { HG.dom.text('#selSuggest', ''); return; }
    const g = suggest();
    if (!userTouched) {
      sel().interval = g.interval;
      sel().offset = 0;
      apply();
    }
    const cur = current();
    HG.dom.html('#selSuggest',
      '推奨：' + g.interval + ' コマおき（Δv の向きの不確かさ ±' + g.angle.toFixed(0) + '°）' +
      '<br>いまの ' + sel().interval + ' コマおき：<b>Δv の向きの不確かさ ±' +
      cur.angle.toFixed(0) + '°</b>（ジッタの目安 ' + g.jitter.toFixed(2) + ' px）' +
      (cur.angle > 15 ? '<br><span class="warn">⑤の判定は ±15° です。この間隔では自動算出側の' +
        'ばらつきが判定幅を超えます。間隔を広げるか、スローで撮り直してください。</span>' : '') +
      (g.accWeak ? '<br>この素材では、どの間隔でも Δv がジッタと同じくらいの大きさにとどまります。' +
                   '間隔を変えても改善しない場合は、素材の側の性質です。' : ''));
  }

  function attach() {
    $('#selInterval').oninput = e => { userTouched = true; sel().interval = +e.target.value; apply(); };
    $('#selInterval').onchange = commit;
    $('#selOffset').oninput = e => { userTouched = true; sel().offset = +e.target.value; apply(); };
    $('#selOffset').onchange = commit;
    $('#selCount').oninput = e => { userTouched = true; sel().count = +e.target.value; apply(); };
    $('#selCount').onchange = commit;
    $('#showPreview').onchange = e => { preview = e.target.checked; HG.refresh(); };
    $('#useSuggest').onclick = () => {
      userTouched = true;
      const g = suggest();
      sel().interval = g.interval;
      sel().offset = 0;
      commit();
    };

    HG.bus.on('points:changed', showSuggestion);
    HG.bus.on('trim:changed', () => { if (active) apply(); else showSuggestion(); });
  }

  HG.selection = { attach, list, isActive, suggest, current, leftover, drawPreview, apply, commit, refreshLabels };
})(window.HG = window.HG || {});
