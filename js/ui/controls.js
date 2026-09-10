/* =====================================================================
   ui/controls.js — ボタンの配線とラベル更新

   ここは「操作 → HG.xxx の呼び出し」の対応表。ロジックは持たせない。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  function attach() {
    /* --- コマ送り --- */
    $('#prev').onclick   = () => HG.frames.showFrame(HG.ui.current - 1);
    $('#next').onclick   = () => HG.frames.showFrame(HG.ui.current + 1);
    $('#prev10').onclick = () => HG.frames.showFrame(HG.ui.current - 10);
    $('#next10').onclick = () => HG.frames.showFrame(HG.ui.current + 10);

    /* --- トリム --- */
    $('#setIn').onclick = () => {
      const out = (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);
      HG.state.trim.inIndex = Math.min(HG.ui.current, out);
      HG.bus.emit('trim:changed');
    };
    $('#setOut').onclick = () => {
      HG.state.trim.outIndex = Math.max(HG.ui.current, HG.state.trim.inIndex);
      HG.bus.emit('trim:changed');
    };
    $('#resetTrim').onclick = () => {
      HG.state.trim.inIndex = 0;
      HG.state.trim.outIndex = HG.state.frames.length - 1;
      HG.bus.emit('trim:changed');
    };

    /* --- 打点 --- */
    $('#delCur').onclick = () => HG.points.removeCurrent();
    $('#undo').onclick = () => {
      const i = HG.points.undo();
      if (i !== null) HG.frames.showFrame(i);
    };
    $('#clearAll').onclick = () => {
      if (confirm('打点をすべて消します。よろしいですか？')) HG.points.clearAll();
    };
    $('#showAll').onchange = e => { HG.overlay.options.showAll = e.target.checked; HG.stage.render(); };
    $('#showNum').onchange = e => { HG.overlay.options.showNum = e.target.checked; HG.stage.render(); };

    /* --- 書き出し・その他 --- */
    $('#csv').onclick = () => HG.exporter.csv();
    $('#dump').onclick = () => HG.exporter.dump();
    $('#rot').onclick = () => HG.frames.rotate90();
    $('#reload').onclick = () => location.reload();

    usePointHandler();
  }

  /** タップ＝打点。打ったら自動で次のコマへ（既定の動作） */
  function usePointHandler() {
    HG.pointer.setHandler(p => {
      HG.points.put(p.ox, p.oy);
      if (!$('#autoAdv').checked) return;
      const step = Math.max(1, parseInt($('#advStep').value, 10) || 1);
      const out = (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);
      const nx = Math.min(HG.ui.current + step, out);
      if (nx !== HG.ui.current) HG.frames.showFrame(nx);
    });
  }

  function updateLabels() {
    const fr = HG.state.frames;
    if (!fr.length) return;
    const f = fr[HG.ui.current];
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);

    HG.dom.text('#frameLabel', 'コマ ' + HG.ui.current + ' / ' + (fr.length - 1));
    HG.dom.text('#timeLabel', 't = ' + (f ? f.t.toFixed(3) : '0.000') + ' s');
    HG.dom.text('#trimLabel',
      'イン ' + inI + '（' + fr[inI].t.toFixed(3) + ' s） 〜 アウト ' + outI +
      '（' + fr[outI].t.toFixed(3) + ' s）／' + (outI - inI + 1) + ' コマ');

    const inTrim = HG.points.listInTrim();
    const man = inTrim.filter(p => p.manual).length;
    HG.dom.text('#ptLabel',
      '区間内 ' + inTrim.length + ' 点（自動 ' + (inTrim.length - man) + ' ／ 手動 ' + man + '）' +
      (inTrim.length && inTrim.length <= 20 ? '／コマ ' + inTrim.map(p => p.index).join(', ') : ''));
  }

  HG.controls = { attach, updateLabels, usePointHandler };
})(window.HG = window.HG || {});
