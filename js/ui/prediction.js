/* =====================================================================
   ui/prediction.js — 予測ステップ

   解析の**前**に「加速度はどっちを向くと思う？」を問う。

   予測 → 検証で驚きが生まれるのは、生徒が間違った予測に賭けた後だけ。
   何となく選んで結果を見た場合、人は「そう思ってた」と記憶を書き換える。
   だから
     ・選んだ記号を大きく、消えない位置に残す
     ・⑤⑥で自分の予測矢印を薄い灰色で重ねる（逃げ場を無くす）

   このアプリでは分布の集計・共有は行わない（別の集計アプリを使う）。
   サーバー送信も、回答の保存・共有も実装しない。
   役割は「選ばせる・記号を見せる・重ねる」の3つだけ。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  let enabled = true;

  /* ---------- 予測の向きを実際のベクトルにする ---------- */

  /** その点での速度の向き（前後の平均） */
  function velAt(k) {
    const a = HG.drawing.autoVelocity(k - 1), b = HG.drawing.autoVelocity(k);
    if (a && b) return { dx: (a.dx + b.dx) / 2, dy: (a.dy + b.dy) / 2 };
    return b || a || null;
  }

  /** 3点を通る円の中心（軌道が曲がる中心）。ほぼ直線なら null */
  function curvatureCenter(k) {
    const p = HG.drawing.pts();
    const a = p[k - 1], b = p[k], c = p[k + 1];
    if (!a || !b || !c) return null;
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-6) return null;
    const sa = a.x * a.x + a.y * a.y, sb = b.x * b.x + b.y * b.y, sc = c.x * c.x + c.y * c.y;
    const ux = (sa * (b.y - c.y) + sb * (c.y - a.y) + sc * (a.y - b.y)) / d;
    const uy = (sa * (c.x - b.x) + sb * (a.x - c.x) + sc * (b.x - a.x)) / d;
    const r = Math.hypot(ux - b.x, uy - b.y);
    if (r > HG.state.video.width * 8) return null;      // ほぼ直線
    return { x: ux, y: uy };
  }

  function norm(v) {
    if (!v) return null;
    const l = Math.hypot(v.dx, v.dy);
    return l < 1e-9 ? null : { dx: v.dx / l, dy: v.dy / l };
  }

  /** 点 k における、予測の向き（単位ベクトル）。zero や求まらない場合は null */
  function dirAt(k) {
    const a = answerForPoint(k);
    if (!a) return null;
    const p = HG.drawing.pts();
    switch (a.dir) {
      case 'down': return { dx: 0, dy: 1 };
      case 'up': return { dx: 0, dy: -1 };
      case 'tangent': return norm(velAt(k));
      case 'back': { const v = norm(velAt(k)); return v ? { dx: -v.dx, dy: -v.dy } : null; }
      case 'center': {
        const c = curvatureCenter(k);
        return c && p[k] ? norm({ dx: c.x - p[k].x, dy: c.y - p[k].y }) : null;
      }
      case 'outward': {
        const c = curvatureCenter(k);
        return c && p[k] ? norm({ dx: p[k].x - c.x, dy: p[k].y - c.y }) : null;
      }
      case 'fixed': return norm(a.vec);      // 自由測定：生徒が描いた1本
      case 'equilibrium': {
        if (!p.length || !p[k]) return null;
        let sx = 0, sy = 0;
        p.forEach(f => { sx += f.x; sy += f.y; });
        return norm({ dx: sx / p.length - p[k].x, dy: sy / p.length - p[k].y });
      }
      default: return null;    // zero
    }
  }

  /**
   * 点 k に対応する予測の答え。
   * 斜方投射のように局面ごとに聞いた場合は、その点が上昇中・頂点・下降中の
   * どれかを速度から判定して選ぶ。誤答が集中する頂点に、その生徒が頂点で
   * 選んだ答えが重なる。
   */
  function answerForPoint(k) {
    const pr = HG.state.drawing.prediction;
    if (!pr || !pr.answers || !pr.answers.length) return null;
    const phased = pr.answers.filter(a => a.phase);
    if (!phased.length) return pr.answers[0];

    const p = HG.drawing.pts();
    let top = -1, best = Infinity;
    for (let i = 0; i < p.length; i++) {
      const v = velAt(i);
      if (v && Math.abs(v.dy) < best) { best = Math.abs(v.dy); top = i; }
    }
    const v = velAt(k);
    const phase = (k === top) ? 'top' : (v && v.dy < 0 ? 'up' : 'down');
    return pr.answers.filter(a => a.phase === phase)[0] || pr.answers[0];
  }

  /* ---------- UI ---------- */

  let preset = null;

  /** タイルで選ばれた運動を受け取る */
  function setPreset(pr) {
    preset = pr;
    HG.state.drawing.prediction = null;
    HG.dom.hide('#predAnswerBig');
    HG.dom.hide('#predStrip');
    HG.dom.show('#predBody');
    renderQuestions();
    /* ストロボ専用モードには予測がない */
    $('#predCard').classList.toggle('hide', !enabled || !pr || !pr.predictions.length);
  }

  function renderQuestions() {
    if (!preset) return;
    if (preset.freeDraw) {
      /* 自由測定では固定の四択が作れない。代わりに、解析のあと・作図の前に
         「加速度の矢印がどこを向くと思うか」を1本描かせる（draw-steps 側）。
         自分でお題を選んだ場合、予測が外れる確率はプリセットより高く、
         ここが自由モードの一番おいしい部分。 */
      HG.dom.html('#predQuestions',
        '<div class="sub">この運動では、ストロボ画像を作ったあとに' +
        '「加速度の矢印がどこを向くと思うか」を<b>1本描いてから</b>作図に進みます。</div>');
      HG.dom.hide('#predSave');
      return;
    }
    HG.dom.show('#predSave');
    HG.dom.html('#predQuestions', preset.predictions.map((q, qi) =>
      '<div class="pred-q">' +
        '<div class="pred-qtext">' + q.q + '</div>' +
        q.options.map(o =>
          '<label class="pred-opt"><input type="radio" name="predq' + qi + '" value="' + o.id + '">' +
          '<b>' + o.id + '</b> ' + o.label + '</label>').join('') +
      '</div>').join(''));
  }

  function save() {
    if (!preset) return;
    const answers = [];
    preset.predictions.forEach((q, qi) => {
      const el = document.querySelector('input[name="predq' + qi + '"]:checked');
      if (!el) return;
      const o = q.options.filter(x => x.id === el.value)[0];
      answers.push({ q: q.q, phase: q.phase || null, id: o.id, label: o.label, dir: o.dir });
    });
    if (answers.length < preset.predictions.length) {
      alert('すべての問いに答えてください。');
      return;
    }
    HG.state.drawing.prediction = { presetId: preset.id, answers: answers };
    showAnswer();
  }

  /** 記号を大きく、消えない位置に。生徒はこの画面を見て集計アプリに転記する */
  function showAnswer() {
    const pr = HG.state.drawing.prediction;
    if (!pr) return;
    const letters = pr.answers.map(a => a.id).join(' / ');
    const detail = pr.answers.map((a, i) =>
      '<div class="pred-line">' + (pr.answers.length > 1 ? (i + 1) + '問目：' : '') +
      '<b>' + a.id + '</b> ' + a.label + '</div>').join('');
    const html = '<div class="pred-title">あなたの予測</div>' +
                 '<div class="pred-big">' + letters + '</div>' + detail +
                 '<div class="sub spaced-sm">この記号を集計アプリに転記してください。' +
                 '解析のあいだも画面の上に出したままにします。</div>';
    HG.dom.html('#predAnswerBig', html);
    HG.dom.show('#predAnswerBig');
    HG.dom.hide('#predBody');
    HG.dom.html('#predStrip', '予測：<b class="pred-strip-big">' + letters + '</b>');
    HG.dom.show('#predStrip');
  }

  function setEnabled(on) {
    enabled = on;
    $('#predBody').classList.toggle('hide', !on || !!HG.state.drawing.prediction);
    $('#predAnswerBig').classList.toggle('hide', !on || !HG.state.drawing.prediction);
    $('#predStrip').classList.toggle('hide', !on || !HG.state.drawing.prediction);
    if (!on) HG.state.drawing.prediction = null;
  }

  function attach() {
    $('#predSave').onclick = save;
    $('#predRedo').onclick = () => {
      HG.state.drawing.prediction = null;
      HG.dom.hide('#predAnswerBig');
      HG.dom.hide('#predStrip');
      HG.dom.show('#predBody');
      renderQuestions();
    };
    $('#usePrediction').onchange = e => setEnabled(e.target.checked);
    setEnabled($('#usePrediction').checked);
  }

  /** 自由測定で描かれた予測の矢印を保存する */
  function setFreeVector(v) {
    HG.state.drawing.prediction = {
      presetId: 'free',
      answers: [{ q: '加速度の向きの予測', phase: null, id: '自分の予測', label: '描いた向き', dir: 'fixed', vec: v }]
    };
  }

  HG.prediction = { attach, setPreset, setFreeVector, dirAt, answerForPoint, isEnabled: () => enabled };
})(window.HG = window.HG || {});
