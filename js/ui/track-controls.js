/* =====================================================================
   ui/track-controls.js — 自動追跡の操作まわり

   ポインタのモード（打点／色を指定／マーカーを指定）はここで切り替える。
   切り替えは HG.pointer.setHandler() の差し替えだけ。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  function hint(text) {
    const h = $('#hint');
    h.textContent = text;
    h.classList.remove('fade');
  }
  function hintDefault() {
    hint('画面をタップで打点／長押しでルーペ');
    if (HG.points.list().length) $('#hint').classList.add('fade');
  }

  /** 一時的にタップの意味を変える（1回だけ） */
  function pickOnce(message, done) {
    hint(message);
    HG.pointer.setHandler(p => {
      HG.controls.usePointHandler();
      done(p);
      hintDefault();
    });
  }

  function showColor() {
    const c = HG.state.tracking.target;
    $('#colorChip').style.background = HG.color.hsvToCss(c);
    HG.dom.text('#colorLabel', '色相 ' + c.h.toFixed(0) + '° ／ 彩度 ' + c.s.toFixed(2));
  }

  function attach() {
    /* --- 追う色の指定 --- */
    $('#pickColor').onclick = () => pickOnce('追いたいシールをタップしてください', p => {
      const c = HG.tracker.pickColorAt(p.ox, p.oy);
      if (!c) { alert('その位置からは色を読み取れませんでした。シールの中心あたりをもう一度タップしてください。'); return; }
      showColor();
      HG.dom.text('#trackResult', '色を指定しました。「自動追跡を実行」を押してください。');
    });

    /* --- 固定マーカーの指定 --- */
    $('#pickMarker').onclick = () => pickOnce('動かない場所に貼ったシールをタップしてください', p => {
      HG.state.tracking.markerStart = { x: p.ox, y: p.oy };
      HG.dom.text('#trackResult', '固定マーカーを指定しました。追跡すると、このマーカーの変位を差し引きます。');
      HG.refresh();
    });

    /* --- 閾値 --- */
    $('#hueTol').oninput = e => {
      HG.state.tracking.hueTol = +e.target.value;
      HG.dom.text('#hueTolVal', e.target.value + '°');
    };
    $('#satMin').oninput = e => {
      HG.state.tracking.satMin = +e.target.value / 100;
      HG.dom.text('#satMinVal', (e.target.value / 100).toFixed(2));
    };

    /* --- カメラぶれ補正の ON/OFF --- */
    $('#useMarker').onchange = e => {
      HG.state.tracking.useMarker = e.target.checked;
      HG.points.applyCorrection();
      HG.bus.emit('points:changed');
    };

    /* --- 実行 --- */
    $('#runTrack').onclick = run;
    $('#clearTrack').onclick = () => {
      HG.tracker.clearAuto();
      HG.dom.text('#trackResult', '追跡結果を消しました（手動打点は残っています）。');
      HG.dom.hide('#gotoLost');
      HG.diagnostics.render();
    };

    /* --- 見失ったコマへ --- */
    let lostAt = 0;
    $('#gotoLost').onclick = () => {
      const r = HG.state.tracking.report;
      if (!r || !r.lost.length) return;
      lostAt = lostAt % r.lost.length;
      HG.frames.showFrame(r.lost[lostAt++]);
    };

    showColor();
  }

  async function run() {
    const btn = $('#runTrack');
    btn.disabled = true;
    HG.dom.show('#trackBar');
    HG.dom.text('#trackResult', '追跡しています…');

    const bar = $('#trackBar').firstElementChild;
    let report = null;
    try {
      report = await HG.tracker.trackAll(p => {
        bar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
      });
    } catch (e) {
      console.error(e);
      HG.dom.text('#trackResult', '追跡中にエラーが起きました。コンソールを確認してください。');
    }

    HG.dom.hide('#trackBar');
    btn.disabled = false;
    await HG.frames.showFrame(HG.ui.current);   // 再生で動いた表示位置を戻す
    HG.diagnostics.render();

    if (!report) {
      HG.dom.text('#trackResult', '追跡するコマがありません（すべて手動打点済みか、区間が空です）。');
      return;
    }
    const lost = report.lost.length;
    HG.dom.text('#trackResult',
      report.total + ' コマ中 ' + report.tracked + ' コマを追跡しました' +
      (lost ? '（見失い ' + lost + ' コマ：' + report.lost.slice(0, 8).join(', ') + (lost > 8 ? ' …' : '') + '）'
            : '（見失いなし）') +
      (report.markerUsed ? '／マーカーのぶれ 最大 ' + report.markerDrift.toFixed(1) + ' px' : ''));
    $('#gotoLost').classList.toggle('hide', lost === 0);
  }

  HG.trackControls = { attach, hintDefault };
})(window.HG = window.HG || {});
