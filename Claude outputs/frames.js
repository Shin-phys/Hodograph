/* =====================================================================
   video/frames.js — 1コマの取り出し（シーク・回転補正・オフスクリーン描画）

   ここが「動画 → 1枚の画像」の唯一の入口。フェーズ2の色追跡も
   フェーズ3の背景差分も、この offscreen キャンバスの画素を読む。
   ===================================================================== */
(function (HG) {
  'use strict';

  const offscreen = document.createElement('canvas');
  const octx = offscreen.getContext('2d', { willReadFrequently: true });
  let seekToken = 0;

  function video() { return HG.state.video.element; }

  /** 回転を考慮して「元解像度」を決め直す */
  function setVideoSize() {
    const v = video();
    const vw = v.videoWidth, vh = v.videoHeight;
    const r = HG.state.video.rotation;
    HG.state.video.width = (r % 180 === 0) ? vw : vh;
    HG.state.video.height = (r % 180 === 0) ? vh : vw;
    offscreen.width = HG.state.video.width;
    offscreen.height = HG.state.video.height;
  }

  function seekTo(t) {
    const v = video();
    return new Promise(res => {
      if (Math.abs(v.currentTime - t) < 1e-6) { res(); return; }
      const h = () => { v.removeEventListener('seeked', h); res(); };
      v.addEventListener('seeked', h);
      v.currentTime = t;
      setTimeout(res, 2500);   // 念のためのタイムアウト
    });
  }

  /** 現在の再生位置のコマを、回転補正して offscreen に描く */
  function drawToOffscreen() {
    const v = video();
    const r = HG.state.video.rotation, vw = v.videoWidth, vh = v.videoHeight;
    octx.save();
    octx.clearRect(0, 0, offscreen.width, offscreen.height);
    if (r === 90)       { octx.translate(offscreen.width, 0);  octx.rotate(Math.PI / 2); }
    else if (r === 180) { octx.translate(offscreen.width, offscreen.height); octx.rotate(Math.PI); }
    else if (r === 270) { octx.translate(0, offscreen.height); octx.rotate(-Math.PI / 2); }
    octx.drawImage(v, 0, 0, vw, vh);
    octx.restore();
  }

  /**
   * 1コマ描いて、画素が読めるかを確かめる。
   * @returns {Promise<'ok'|'draw'|'taint'>}
   *   'draw'  … HEVC などで描けない（真っ黒になる）
   *   'taint' … canvas が汚染されて getImageData が使えない
   *             （file:// で別ファイルの動画を読んだとき）
   */
  async function testDraw() {
    const v = video();
    try {
      await seekTo(Math.min(0.1, (v.duration || 1) * 0.1));
      drawToOffscreen();
    } catch (e) { return 'draw'; }
    try {
      const w = Math.min(64, offscreen.width), h = Math.min(64, offscreen.height);
      const d = octx.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum > 0 ? 'ok' : 'draw';
    } catch (e) {
      return (e && e.name === 'SecurityError') ? 'taint' : 'draw';
    }
  }

  /** i 番目のコマを表示する（シーク完了後に frame:changed を発火） */
  async function showFrame(i) {
    const fr = HG.state.frames;
    if (!fr.length) return;
    /* 「イン〜アウトだけを表示する」が入っていれば、コマ送りは区間の外へ出ない。
       トリムしたあとに端まで戻ってしまうのを防ぐ。 */
    const r = HG.frames.range();
    i = Math.max(r.lo, Math.min(r.hi, i));
    HG.ui.current = i;
    const f = fr[i], nx = fr[i + 1];
    // コマの内側に確実に着地させるため、わずかに後ろへずらしてシークする
    const eps = nx ? Math.min(0.004, (nx.t - f.t) * 0.4) : 0.004;
    const my = ++seekToken;
    await seekTo(f.t + eps);
    if (my !== seekToken) return;   // 追い越されたら描かない
    HG.bus.emit('frame:changed', i);
  }

  function rotate90() {
    const old = { w: HG.state.video.width, h: HG.state.video.height };
    HG.state.video.rotation = (HG.state.video.rotation + 90) % 360;
    setVideoSize();
    HG.points.rotate90(old.w, old.h);
    HG.bus.emit('view:changed');
  }

  /**
   * コマ送りやタイムラインが動ける範囲。
   * HG.ui.limitToTrim が立っていればイン点〜アウト点、そうでなければ全体。
   */
  function range() {
    const fr = HG.state.frames;
    const last = Math.max(0, fr.length - 1);
    if (!HG.ui.limitToTrim) return { lo: 0, hi: last };
    const out = (HG.state.trim.outIndex === null ? last : HG.state.trim.outIndex);
    return { lo: HG.state.trim.inIndex, hi: Math.max(HG.state.trim.inIndex, out) };
  }

  HG.frames = { offscreen, setVideoSize, seekTo, drawToOffscreen, testDraw, showFrame, rotate90, range };
})(window.HG = window.HG || {});
