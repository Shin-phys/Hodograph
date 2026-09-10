/* =====================================================================
   ui/selection.js — 使うコマの選択（等間隔を強制する）

   自由なコマ選択にはしない。Δt が不揃いになった瞬間に速度も加速度も
   すべて破綻するため、UI は「開始コマ・間隔・個数」の3つだけにする。

   間隔を動かすと加速度ベクトルのプレビューがその場で更新される。
   加速度は二階差分なので、間隔が狭いとジッタで矢印が暴れ、広いと曲率の
   バイアスが乗る。教師が授業前に「この素材はこの間隔」と決めるための表示。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  let active = false;

  /**
   * 選ばれたコマ。
   * 座標が1つも無いときは座標なしのまま返す。ストロボ画像（中央値背景＋差分）は
   * 「動いた」という事実だけで作れるので、追跡できない対象でも通せるようにする。
   */
  function list() {
    const s = HG.state.selection, fr = HG.state.frames;
    const anyFound = fr.some(f => f.found);
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);
    const out = [];
    for (let k = 0; k < s.count; k++) {
      const i = s.startIndex + k * s.interval;
      if (i >= fr.length || i > outI) break;      // 区間の外まで伸ばさない
      const f = fr[i];
      if (f && (f.found || !anyFound)) out.push(f);
    }
    return out;
  }

  /** 選択が有効か（フェーズ4以降で「この10コマ」を指す） */
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
   *
   *  (1) コマ間の変位がジッタの 10 倍以上     … 速度が読めるための条件
   *  (2) Δv の向きの不確かさが 12°以下        … 加速度の向きが読めるための条件
   *
   * (2) は開発プロンプトの「ジッタの10倍」を、このアプリの目的（向きを見る）に
   * 合わせて言い直したもの。⑤の判定が ±15° なので、自動算出側の不確かさが
   * それを超えていては判定にならない。
   *
   * (1) だけだと足りない。合成動画（真値 200 px/s²）で確かめたところ、
   * (1) を満たす間隔1コマでは加速度が 0 と出た。二階差分の大きさが
   * 座標の丸めに埋もれるためで、このアプリの目的（加速度の向きを見る）
   * では (2) が効く。逆に広げすぎると曲率のバイアスが乗るので、
   * 条件を満たす最小の間隔を選ぶ。
   *
   * @returns {{interval, ratio, accRatio, jitter}}
   */
  function suggest() {
    const f = HG.points.listInTrim();
    const j = jitter();
    if (f.length < 4) return { interval: 1, ratio: 0, accRatio: 0, jitter: j, angle: 90 };
    const median = a => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)] || 0; };

    let firstOk1 = null;     // 条件(1)だけ満たす最小の間隔
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
    /* 条件(2)がどこでも満たせない＝加速度が小さい運動（等速に近い）。
       台車の等速運動では Δv は本当にゼロなので、これは異常ではない。
       間隔を無駄に広げず、条件(1)を満たす最小の間隔を返す。 */
    if (firstOk1) {
      firstOk1.accWeak = true;
      /* 加速度で間隔を決められないなら、代わりに区間全体へ点を散らす。
         等速運動のストロボ画像が数コマぶんに固まって潰れるのを防ぐ。
         ただし手動打点は飛び飛びなので、実在する点の間隔の倍数に丸める。
         丸めないと、打点のあるコマをまたいでしまい選択が空になる。 */
      const inI = HG.state.trim.inIndex;
      const outI = (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);
      const spread = Math.floor((outI - inI) / Math.max(1, HG.state.selection.count - 1));
      let best = firstOk1.interval;
      for (let m = 1; m < f.length; m++) {
        const iv = f[m].index - f[0].index;
        if (iv <= Math.max(spread, firstOk1.interval)) best = Math.max(best, iv);
      }
      firstOk1.interval = Math.max(1, best);
      return firstOk1;
    }
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
  function drawPreview(ctx) {
    if (!active) return;
    if (HG.draw && HG.draw.active()) return;   // 作図中は自動の矢印を出さない（答えを見せない）
    const sel = list().filter(f => f.found);
    if (sel.length < 3) return;
    const s = HG.view.scale;
    const strobe = HG.stage.mode() === 'strobe';
    const pos = f => strobe ? { x: f.x * s, y: f.y * s } : { x: f.rawX * s, y: f.rawY * s };

    /* Δv = 速度の差。速度は隣り合う位置の差。
       時刻の対応：v は中間時刻、Δv は元のコマの位置に対応する（半コマずれ） */
    const dv = [];
    for (let i = 1; i < sel.length - 1; i++) {
      dv.push({
        at: sel[i],
        dx: (sel[i + 1].x - sel[i].x) - (sel[i].x - sel[i - 1].x),
        dy: (sel[i + 1].y - sel[i].y) - (sel[i].y - sel[i - 1].y)
      });
    }
    const lens = dv.map(d => Math.hypot(d.dx, d.dy)).sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)] || 0;
    const j = jitter();

    /* Δv がジッタに埋もれているときは拡大しない。
       ノイズを引き伸ばして「それらしい矢印」を出すと嘘になる。
       ゼロベクトルは消さずに点で示す（ゼロベクトルもベクトルである）。 */
    if (med < 3 * j) {
      dv.forEach(d => {
        const p = pos(d.at);
        HG.arrows.dot(ctx, p.x, p.y, { color: '#ff7a00' });
      });
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

    const target = HG.state.video.width * 0.10;          // 中央値がこの長さになるよう伸ばす
    const k = target / med;
    dv.forEach(d => {
      const p = pos(d.at);
      HG.arrows.draw(ctx, p.x, p.y, p.x + d.dx * k * s, p.y + d.dy * k * s,
        { color: '#ff7a00', width: 2.5, head: 10, alpha: 0.95 });
    });
  }

  /* ---------- UI ---------- */
  function refreshLabels() {
    const s = HG.state.selection;
    HG.dom.text('#selStartVal', String(s.startIndex));
    HG.dom.text('#selIntervalVal', s.interval + ' コマ');
    HG.dom.text('#selCountVal', s.count + ' 点');
    const sel = list();
    const dt = sel.length > 1 ? (sel[1].t - sel[0].t) : 0;
    HG.dom.text('#selInfo', sel.length
      ? '選択 ' + sel.length + ' 点／コマ ' + sel.map(f => f.index).join(', ') +
        '／点の間隔 ' + (dt * 1000).toFixed(0) + ' ms'
      : '座標のあるコマがありません。先に追跡か手動打点をしてください。');
  }

  function clampToTrim() {
    const s = HG.state.selection;
    /* 個数はユーザーの希望として保持し、はみ出しは list() 側で打ち切る。
       ここで count を削ると、間隔を戻したときに個数が元に戻らない。 */
    if (s.interval < 1) s.interval = 1;
    $('#selCount').value = s.count;
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);
    if (s.startIndex < inI) s.startIndex = inI;
    if (s.startIndex > outI) s.startIndex = inI;
    $('#selStart').min = inI;
    $('#selStart').max = Math.max(inI, outI);
    $('#selStart').value = s.startIndex;
  }

  function apply() {
    clampToTrim();
    refreshLabels();
    if (userTouched) showSuggestion();
    active = true;
    HG.refresh();
    HG.bus.emit('selection:changed');
  }

  function attach() {
    $('#selStart').oninput = e => { userTouched = true; HG.state.selection.startIndex = +e.target.value; apply(); };
    $('#selInterval').oninput = e => { userTouched = true; HG.state.selection.interval = +e.target.value; apply(); };
    $('#selCount').oninput = e => { userTouched = true; HG.state.selection.count = +e.target.value; apply(); };

    $('#useSuggest').onclick = () => {
      userTouched = true;
      const g = suggest();
      HG.state.selection.interval = g.interval;
      $('#selInterval').value = g.interval;
      apply();
    };

    HG.bus.on('points:changed', showSuggestion);
    HG.bus.on('trim:changed', () => { if (active) apply(); else showSuggestion(); });
  }

  let userTouched = false;   // スライダを一度でも触ったら自動追従をやめる
  function showSuggestion() {
    const f = HG.points.listInTrim();
    if (f.length < 4) { HG.dom.text('#selSuggest', ''); return; }
    const g = suggest();
    /* 教師が最初に見る画面が「もっともらしい10点＋加速度プレビュー」になるよう、
       スライダを触るまでは推奨値に追従させる。1回で固定すると、打点の途中の
       少ない点で決めた間隔が残ってしまい、打ち終わったときに選択が空になる。 */
    if (!userTouched) {
      HG.state.selection.interval = g.interval;
      HG.state.selection.startIndex = f[0].index;
      $('#selInterval').value = g.interval;
      apply();
    }
    /* いま選んでいる間隔での不確かさも出す。教師が間隔を動かしながら
       「この素材はここまで」と判断できるのは、比の数字ではなくこの角度。 */
    const cur = current();
    HG.dom.html('#selSuggest',
      '推奨：間隔 ' + g.interval + ' コマ（Δv の向きの不確かさ ±' + g.angle.toFixed(0) + '°）' +
      '<br>いまの間隔 ' + HG.state.selection.interval + ' コマ：<b>Δv の向きの不確かさ ±' +
      cur.angle.toFixed(0) + '°</b>（ジッタの目安 ' + g.jitter.toFixed(2) + ' px）' +
      (cur.angle > 15 ? '<br><span class="warn">⑤の判定は ±15° です。この間隔では自動算出側の' +
        'ばらつきが判定幅を超えます。間隔か個数を増やすか、スローで撮り直してください。</span>' : '') +
      (g.accWeak ? '<br>この運動は加速度が小さく、どの間隔でも Δv がジッタに埋もれます。' +
                   '等速に近い運動ならこれで正しく、Δv ≒ 0 が結論になります。' : ''));
  }

  HG.selection = { attach, list, isActive, suggest, current, drawPreview, apply, refreshLabels };
})(window.HG = window.HG || {});
