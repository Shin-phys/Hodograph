/* =====================================================================
   video/loader.js — 動画ファイルの受け取りとメタデータ確定

   サーバー送信は一切しない。ブラウザ内で完結する。
   ===================================================================== */
(function (HG) {
  'use strict';

  /**
   * @returns {Promise<{ok:boolean, reason?:string}>}
   *   reason: 'decode'（開けない） / 'draw'（HEVC 等で画像化できない）
   *           / 'taint'（file:// で画素が読めない）
   */
  async function load(file, videoEl) {
    /* 同梱のお手本動画は URL 文字列で渡す。file:// でも <video src> なら開ける
       （fetch は file:// で弾かれるので使わないこと）。 */
    videoEl.src = (typeof file === 'string') ? file : URL.createObjectURL(file);
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.preload = 'auto';

    try {
      await new Promise((res, rej) => {
        videoEl.onloadedmetadata = res;
        videoEl.onerror = () => rej(new Error('decode'));
        setTimeout(() => rej(new Error('timeout')), 20000);
      });
    } catch (e) {
      return { ok: false, reason: 'decode' };
    }

    HG.state.video.element = videoEl;
    HG.state.video.duration = videoEl.duration || 0;
    HG.state.video.rotation = 0;
    HG.frames.setVideoSize();

    // 回転メタデータ：多くのブラウザは videoWidth/Height に反映済みだが、
    // 横倒しになる端末があるので手動で回せるようにしてある（frames.rotate90）。
    const t = await HG.frames.testDraw();
    if (t !== 'ok') return { ok: false, reason: t };

    HG.bus.emit('video:loaded');
    return { ok: true };
  }

  HG.loader = { load };
})(window.HG = window.HG || {});
