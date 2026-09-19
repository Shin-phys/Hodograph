/* =====================================================================
   ui/tiles.js — トップページ（運動のタイル）とプリセットの流し込み

   入口は「手書き／自動」の選択ではなく、運動の種類のタイルにする。
   手書き／自動は次の画面の小さなトグル。

   プリセットの正体は初期値。タイルを選んだ時点で流し込むだけで、
   生徒は後から全部動かせる。自由測定モードは新規実装ではなく、
   プリセット選択のスキップとして作る。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  function all() { return HG.presets.list.concat([HG.presets.strobeOnly]); }

  function render() {
    HG.dom.html('#tiles', all().map(p =>
      '<button class="tile" data-id="' + p.id + '">' +
        '<span class="tile-name">' + p.name + '</span>' +
        '<span class="tile-sub">' + (p.sub || '') + '</span>' +
      '</button>').join(''));
  }

  /** タイルを選んだ時点で流し込む初期値 */
  function apply(preset) {
    HG.state.preset = preset;
    const t = HG.state.tracking;
    t.target = { h: preset.hue, s: 0.6, v: 0.6 };
    t.markerStart = null;
    HG.state.strobe.cutoutRadius = preset.cutoutRadius;
    /* 点の数はプリセットの目安を流し込む。以前は「間隔から決まるので使わない」と
       していたが、逐次方式＋実寸で描くようになってからは点の数がそのまま
       1本あたりの矢印の長さになるので、運動ごとに適した数が違う。
       生徒はあとからスライダーで動かせる（プリセットの正体は初期値）。 */
    if (preset.count) HG.state.selection.count = preset.count;
    HG.hodo.setMode(preset.hodoMode);
    const sel = $('#hodoMode'); if (sel) sel.value = preset.hodoMode;
    $('#selCount').value = HG.state.selection.count;

    document.body.classList.toggle('mode-strobe', !!preset.strobeOnly);
    document.body.classList.toggle('mode-free', preset.id === 'free');
  }

  /**
   * コマ間隔は「秒」で持ち、実測 fps が分かってからコマ数に直す。
   * 公称 fps は当てにならないので、走査が終わってから当てる。
   */
  function applyInterval() {
    const p = HG.state.preset;
    if (!p || !p.intervalSec) return;
    const st = HG.diagnostics.dtStats();
    if (!st || !st.median) return;
    const frames = Math.max(1, Math.round(p.intervalSec / st.median));
    HG.state.selection.interval = frames;
    $('#selInterval').value = frames;
  }

  function showNote(preset) {
    const tips = (preset.shootTips || []).map(t =>
      '<div class="spaced-sm">' + t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</div>').join('');
    /* preset.note（この運動で何が起きるか）はここでは出さない。
       先に読ませると「予測 → 検証」の驚きが消える。⑤以降の「解説」で出す。 */
    HG.dom.html('#presetNote',
      '<div class="lead">' + preset.name + '</div>' +
      (tips ? '<div class="sub spaced-sm">' + tips + '</div>' : ''));

    /* 自由測定モードでは、守るべきルールを一つだけ常時表示する。
       一つだと分かっていれば、生徒はけっこう守る。 */
    $('#guideFull').classList.toggle('hide', preset.id === 'free');
    $('#guideOne').classList.toggle('hide', preset.id !== 'free');
    $('#ideaCard').classList.toggle('hide', preset.id !== 'free');
    $('#sampleRow').classList.toggle('hide', !preset.sample);
    if (preset.sample) {
      HG.dom.html('#sampleBtn', 'お手本を試す' +
        (preset.sampleNote ? '<span class="sub"> ' + preset.sampleNote + '</span>' : ''));
    }
  }

  function choose(id) {
    const preset = (id === 'strobe') ? HG.presets.strobeOnly : HG.presets.byId(id);
    if (!preset) return;
    apply(preset);
    showNote(preset);
    HG.prediction.setPreset(preset);
    HG.dom.hide('#screen0');
    HG.dom.show('#screen1');
    HG.dom.show('#goHome');
    window.scrollTo(0, 0);
  }

  function attach() {
    render();
    $('#tiles').onclick = e => {
      const el = e.target.closest('[data-id]');
      if (el) choose(el.dataset.id);
    };
    $('#backToTiles').onclick = () => {
      HG.dom.show('#screen0');
      HG.dom.hide('#screen1');
      HG.dom.hide('#goHome');
      window.scrollTo(0, 0);
    };
    HG.dom.html('#ideaList', HG.presets.ideas.map(t => '<li>' + t + '</li>').join(''));
    HG.bus.on('frames:scanned', applyInterval);
  }

  HG.tiles = { attach, choose, apply, applyInterval };
})(window.HG = window.HG || {});
