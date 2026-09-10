/* =====================================================================
   ui/strobe-controls.js — ストロボ画像の操作

   閾値は大津の判別分析法で自動決定したうえで、必ずスライダも出す。
   「物体が欠ける ←→ ゴミが写る」の1軸なので生徒にも意味が分かる。
   自動値だけで済ませないこと。教室の照明条件は予測できない。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  function conf() { return HG.state.strobe; }

  function attach() {
    $('#strobeMethod').onchange = e => {
      conf().method = e.target.value;
      $('#cutoutRow').classList.toggle('hide', e.target.value !== 'cutout');
      $('#thresholdRow').classList.toggle('hide', e.target.value !== 'diff');
      if (HG.strobe.cache.ready) recompose();
    };

    $('#thresholdScale').oninput = e => {
      conf().thresholdScale = +e.target.value / 100;
      HG.dom.text('#thresholdVal', conf().thresholdScale.toFixed(2) + ' 倍');
      if (HG.strobe.cache.ready) recompose();
    };

    $('#cutoutRadius').oninput = e => {
      conf().cutoutRadius = +e.target.value;
      HG.dom.text('#cutoutVal', e.target.value + ' px');
      if (HG.strobe.cache.ready) recompose();
    };

    $('#fadeOld').onchange = e => {
      conf().fadeOld = e.target.checked;
      if (HG.strobe.cache.ready) recompose();
    };

    $('#makeStrobe').onclick = make;
    $('#toggleStrobe').onclick = () => {
      const showing = HG.stage.mode() === 'strobe';
      HG.stage.setSource(showing ? null : HG.strobe.canvas());
      HG.dom.text('#toggleStrobe', showing ? 'ストロボ画像を表示' : '動画に戻る');
      HG.refresh();
    };
    $('#savePng').onclick = savePng;
  }

  async function make() {
    const sel = HG.selection.list();
    if (sel.length < 2) {
      alert('先に「使うコマ」を選んでください（座標のあるコマが2点以上必要です）。');
      return;
    }
    const btn = $('#makeStrobe');
    btn.disabled = true;
    HG.dom.show('#strobeBar');
    HG.dom.text('#strobeInfo', '背景を推定しています…（中央値を取るので少し時間がかかります）');

    const bar = $('#strobeBar').firstElementChild;
    const t0 = performance.now();
    try {
      await HG.strobe.capture(sel.map(f => f.index), p => {
        bar.style.width = Math.round(p * 100) + '%';
      });
    } catch (e) {
      console.error(e);
      HG.dom.text('#strobeInfo', '生成中にエラーが起きました。コンソールを確認してください。');
      btn.disabled = false;
      HG.dom.hide('#strobeBar');
      return;
    }

    /* 閾値の初期値を自動決定（そのうえでスライダで動かせる） */
    conf().autoThreshold = HG.strobe.otsu();
    recompose();

    HG.dom.hide('#strobeBar');
    btn.disabled = false;
    HG.stage.setSource(HG.strobe.canvas());
    HG.dom.text('#toggleStrobe', '動画に戻る');
    HG.dom.show('#strobeAfter');
    HG.bus.emit('strobe:made');
    HG.refresh();

    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    HG.dom.text('#strobeInfo',
      sel.length + ' コマを合成しました（' + sec + ' 秒／' +
      HG.strobe.cache.w + '×' + HG.strobe.cache.h + '）。' +
      '物体が欠ける・ゴミが写るときは閾値を動かしてください。');
  }

  function recompose() {
    const c = conf();
    c.threshold = Math.max(3, (c.autoThreshold || 20) * c.thresholdScale);
    HG.strobe.compose({
      method: c.method,
      threshold: c.threshold,
      fadeOld: c.fadeOld,
      cutoutRadius: c.cutoutRadius
    });
    if (c.method === 'diff') {
      const ratio = HG.strobe.maxMaskRatio(c.threshold);
      HG.dom.text('#thresholdInfo',
        '閾値 ' + c.threshold.toFixed(0) + '（自動値 ' + (c.autoThreshold || 0).toFixed(0) + '）' +
        '／画面の ' + (ratio * 100).toFixed(1) + ' % が「動いた」と判定');
      if (ratio > 0.9) {
        HG.dom.html('#thresholdInfo', '<span class="warn">画面のほぼ全体が「動いた」と判定されています。' +
          '明るさが変化しているか、閾値が低すぎます。AE をロックして撮り直すか、閾値を上げてください。</span>');
      }
    } else {
      HG.dom.text('#thresholdInfo', '');
    }
    HG.refresh();
  }

  /** PNG 書き出し。番号は焼き込む（生徒がレポートに貼るため） */
  function savePng() {
    if (!HG.strobe.cache.ready) { alert('先にストロボ画像を作ってください。'); return; }
    const src = HG.strobe.canvas();
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(src, 0, 0);

    const k = HG.strobe.cache.scale;
    const sel = HG.selection.list();
    const R = Math.max(4, cv.width * 0.008);
    sel.forEach((f, i) => {
      const x = f.x * k, y = f.y * k;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,45,111,.9)';
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.font = Math.round(cv.width * 0.026) + 'px ui-monospace,monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(String(i), x + R * 1.8, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i), x + R * 1.8, y);
    });

    cv.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'strobe.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }, 'image/png');
  }

  HG.strobeControls = { attach, recompose };
})(window.HG = window.HG || {});
