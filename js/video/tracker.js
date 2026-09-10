/* =====================================================================
   video/tracker.js — 自動追跡（色 + 固定マーカーによるカメラぶれ補正）

   前提：運動する物体に蛍光色の丸シール（中心に黒点）を貼って撮影する。
   さらに、動かない場所にもう1枚同じシールを貼ってもらうと、その変位を
   差し引くことで三脚のずれ・手ぶれ・電子式手ぶれ補正（EIS）の影響が
   まとめて補正できる。EIS は機種によって切れないので、これが現実解。

   処理の順序（速さのため2パス）
     パスA：トリム区間を1回通し再生し、届いたコマをその場で解析する。
            シークしないので速い。ただし解析が間に合わないと
            コマが飛ぶことがある。
     パスB：パスAで取りこぼしたコマだけをシークして解析する。
   手動打点したコマは上書きしない（自動と手動が混在してよい）。

   解析は縮小画像（既定 480px 幅）で行い、見つけたブロブの近傍だけを
   元解像度で測り直す。速さと座標精度を両立させるため。
   ===================================================================== */
(function (HG) {
  'use strict';

  const an = document.createElement('canvas');       // 解析用の縮小キャンバス
  const actx = an.getContext('2d', { willReadFrequently: true });
  let scale = 1;                                     // 元解像度 → 解析解像度

  function conf() { return HG.state.tracking; }
  function tol() {
    const c = conf();
    return { hueTol: c.hueTol, satMin: c.satMin, valMin: c.valMin };
  }

  function prepare() {
    const w = HG.state.video.width, h = HG.state.video.height;
    const aw = Math.min(w, conf().analysisWidth);
    scale = aw / w;
    an.width = Math.round(aw);
    an.height = Math.round(h * scale);
  }

  /** 現在 offscreen にあるコマを解析解像度に落として画素を得る */
  function analysisImage() {
    actx.drawImage(HG.frames.offscreen, 0, 0, an.width, an.height);
    return actx.getImageData(0, 0, an.width, an.height);
  }

  /**
   * ブロブを元解像度で測り直す。
   * @returns {{x,y,elongation,area}|null} 元解像度の重心
   */
  function refine(blob) {
    const pad = 6;
    const o = HG.frames.offscreen;
    const x0 = Math.max(0, Math.floor(blob.x0 / scale) - pad);
    const y0 = Math.max(0, Math.floor(blob.y0 / scale) - pad);
    const x1 = Math.min(o.width - 1, Math.ceil(blob.x1 / scale) + pad);
    const y1 = Math.min(o.height - 1, Math.ceil(blob.y1 / scale) + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 2 || h < 2) return null;

    const img = o.getContext('2d').getImageData(x0, y0, w, h);
    const m = HG.blob.buildMask(img, conf().target, tol());
    const found = HG.blob.findBlobs(m, 3);
    if (!found.length) return null;
    const b = found[0];
    return { x: x0 + b.cx, y: y0 + b.cy, elongation: b.elongation, area: b.area };
  }

  /**
   * 追跡の出発点。同じ色のシールが2枚（運動体と固定マーカー）写っている
   * ので、「どちらが運動体か」を最初に決めておかないと固定マーカーに
   * 貼り付いてしまう。優先順位は
   *   1. 区間の先頭付近にある手動打点
   *   2. 色を指定するためにタップした位置（＝そのとき見えていた運動体）
   */
  function seed(inI) {
    const fr = HG.state.frames;
    for (let i = inI; i < Math.min(fr.length, inI + 10); i++) {
      if (fr[i].manual && fr[i].rawX !== null) return { x: fr[i].rawX, y: fr[i].rawY };
    }
    const s = conf().seed;
    return s ? { x: s.x, y: s.y } : null;
  }

  /** 前のコマの座標に最も近いブロブを選ぶ（複数見つかったとき） */
  function nearest(blobs, prev) {
    if (!prev) return blobs[0];                      // 最初は最大のブロブ
    let best = null, bd = Infinity;
    for (const b of blobs) {
      const d = Math.hypot(b.cx / scale - prev.x, b.cy / scale - prev.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /* --- 1コマぶんの解析。offscreen に描かれている前提 --- */
  function analyseFrame(ctxState) {
    const img = analysisImage();
    const m = HG.blob.buildMask(img, conf().target, tol());
    const blobs = HG.blob.findBlobs(m, conf().minArea);
    const maskRatio = m.count / (m.width * m.height);

    /* 固定マーカー：前回位置の近くだけを探す（動く物体と取り違えないため） */
    let marker = null;
    const mk = ctxState.markerPrev;
    if (mk) {
      const win = conf().markerWindow;             // 元解像度でのおおよその半径
      const cand = blobs.filter(b =>
        Math.hypot(b.cx / scale - mk.x, b.cy / scale - mk.y) < win);
      if (cand.length) marker = refine(cand[0]);
    }

    /* 運動する物体：マーカーの近傍は除外して探す */
    let moving = null;
    const others = blobs.filter(b => {
      if (!mk) return true;
      return Math.hypot(b.cx / scale - mk.x, b.cy / scale - mk.y) >= conf().markerWindow;
    });
    if (others.length) {
      const pick = nearest(others, ctxState.prev);
      if (pick) moving = refine(pick);
    }

    return { moving, marker, maskRatio, blobCount: blobs.length };
  }

  function store(index, res, ctxState, report) {
    const f = HG.state.frames[index];
    if (res.marker) {
      HG.state.refMarker[index] = { index: index, t: f.t, x: res.marker.x, y: res.marker.y, found: true };
      ctxState.markerPrev = { x: res.marker.x, y: res.marker.y };
    }
    if (res.moving) {
      f.rawX = Math.round(res.moving.x * 10) / 10;   // 手動打点と同じ 0.1px 単位にそろえる
      f.rawY = Math.round(res.moving.y * 10) / 10;
      f.found = true;
      f.manual = false;
      ctxState.prev = { x: res.moving.x, y: res.moving.y };
      report.tracked++;
      if (res.moving.elongation > report.maxElongation) report.maxElongation = res.moving.elongation;
      if (res.moving.elongation > 2.2) report.elongated++;
    } else {
      f.rawX = null; f.rawY = null; f.found = false;
      report.lost.push(index);
      if (!res.blobCount) report.noBlob++;
    }
    if (res.maskRatio > report.maxMaskRatio) report.maxMaskRatio = res.maskRatio;
  }

  /* --- パスA：通し再生しながら解析 --- */
  function playbackPass(indices, ctxState, report, onProgress) {
    return new Promise(resolve => {
      const v = HG.state.video.element;
      const fr = HG.state.frames;
      const last = indices[indices.length - 1];
      const todo = new Set(indices);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        try { v.pause(); } catch (e) {}
        resolve(todo);
      };

      const nearestIndex = t => {                    // mediaTime → コマ番号
        let lo = 0, hi = fr.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (fr[mid].t < t) lo = mid + 1; else hi = mid;
        }
        if (lo > 0 && Math.abs(fr[lo - 1].t - t) < Math.abs(fr[lo].t - t)) lo--;
        return lo;
      };

      /* コマが届かなくなったら打ち切る見張り。
         再生が終わってもコールバックが1回来ないことがあり、
         これが無いと待ち続けてしまう（実際に踏んだ） */
      let watchdog = null;
      const kick = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(finish, 3000);
      };

      const cb = (now, meta) => {
        kick();
        const t = (typeof meta.mediaTime === 'number') ? meta.mediaTime : v.currentTime;
        const i = nearestIndex(t);
        if (todo.has(i)) {
          HG.frames.drawToOffscreen();
          store(i, analyseFrame(ctxState), ctxState, report);
          todo.delete(i);
          onProgress((indices.length - todo.size) / indices.length * 0.9);
        }
        if (i >= last || v.ended || done) { finish(); return; }
        v.requestVideoFrameCallback(cb);
      };

      v.addEventListener('ended', () => setTimeout(finish, 200), { once: true });
      v.playbackRate = 1;
      v.currentTime = fr[indices[0]].t;
      v.requestVideoFrameCallback(cb);
      kick();
      const p = v.play();
      if (p && p.catch) p.catch(finish);
    });
  }

  /**
   * パスBで使う「直前の位置」。パスAの走り終わりの位置をそのまま使うと、
   * 動画の終端の座標を基準に最寄りブロブを選んでしまい、固定マーカーに
   * 飛び移る（実際に踏んだ不具合）。前後の追跡済みコマから取り直す。
   */
  function neighbourSeed(i) {
    const fr = HG.state.frames;
    for (let d = 1; d <= 8; d++) {
      const a = fr[i - d], b = fr[i + d];
      if (a && a.found && a.rawX !== null) return { x: a.rawX, y: a.rawY };
      if (b && b.found && b.rawX !== null) return { x: b.rawX, y: b.rawY };
    }
    return seed(HG.state.trim.inIndex);
  }
  function neighbourMarker(i) {
    const m = HG.state.refMarker || [];
    for (let d = 1; d <= 8; d++) {
      if (m[i - d] && m[i - d].found) return { x: m[i - d].x, y: m[i - d].y };
      if (m[i + d] && m[i + d].found) return { x: m[i + d].x, y: m[i + d].y };
    }
    const ms = conf().markerStart;
    return ms ? { x: ms.x, y: ms.y } : null;
  }

  /* --- パスB：取りこぼしたコマをシークして解析 --- */
  async function seekPass(rest, ctxState, report, onProgress) {
    const fr = HG.state.frames;
    let n = 0;
    for (const i of rest) {
      const nx = fr[i + 1];
      const eps = nx ? Math.min(0.004, (nx.t - fr[i].t) * 0.4) : 0.004;
      await HG.frames.seekTo(fr[i].t + eps);
      HG.frames.drawToOffscreen();
      ctxState.prev = neighbourSeed(i);
      ctxState.markerPrev = neighbourMarker(i);
      store(i, analyseFrame(ctxState), ctxState, report);
      onProgress(0.9 + (++n / rest.length) * 0.1);
    }
  }

  /**
   * トリム区間の全コマを追跡する。手動打点したコマは触らない。
   * @returns {Promise<object>} 診断用のレポート
   */
  async function trackAll(onProgress) {
    prepare();
    const fr = HG.state.frames;
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);

    const indices = [];
    for (let i = inI; i <= outI; i++) if (!fr[i].manual) indices.push(i);
    if (!indices.length) return null;

    HG.state.refMarker = [];
    const ctxState = {
      prev: seed(inI),
      markerPrev: conf().markerStart ? { x: conf().markerStart.x, y: conf().markerStart.y } : null
    };
    const markerBase = ctxState.markerPrev ? { x: ctxState.markerPrev.x, y: ctxState.markerPrev.y } : null;

    const report = {
      ran: true, total: indices.length, tracked: 0, lost: [],
      maxElongation: 1, elongated: 0, noBlob: 0, maxMaskRatio: 0,
      markerDrift: 0, markerUsed: !!markerBase, markerLost: 0
    };

    const rest = await playbackPass(indices, ctxState, report, onProgress || (() => {}));
    if (rest.size) await seekPass(Array.from(rest).sort((a, b) => a - b), ctxState, report, onProgress || (() => {}));

    /* マーカーのぶれ量（最大変位）を集計 */
    if (markerBase) {
      HG.state.refMarker.forEach(m => {
        if (!m) { report.markerLost++; return; }
        const d = Math.hypot(m.x - markerBase.x, m.y - markerBase.y);
        if (d > report.markerDrift) report.markerDrift = d;
      });
    }

    report.lost.sort((a, b) => a - b);
    HG.state.tracking.report = report;
    HG.points.applyCorrection();
    HG.bus.emit('points:changed');
    return report;
  }

  /** 追跡結果だけ消す（手動打点は残す） */
  function clearAuto() {
    HG.state.frames.forEach(f => {
      if (f.manual) return;
      f.rawX = null; f.rawY = null; f.x = null; f.y = null; f.found = false;
    });
    HG.state.refMarker = [];
    HG.state.tracking.report = null;
    HG.bus.emit('points:changed');
  }

  /** 画面上のシールをタップして「この色を追う」を指定する */
  function pickColorAt(ox, oy) {
    const o = HG.frames.offscreen;
    const r = Math.max(4, Math.round(o.width * 0.012));
    const x0 = Math.max(0, Math.round(ox - r)), y0 = Math.max(0, Math.round(oy - r));
    const w = Math.min(o.width - x0, r * 2 + 1), h = Math.min(o.height - y0, r * 2 + 1);
    const img = o.getContext('2d').getImageData(x0, y0, w, h);
    const c = HG.color.sampleAround(img, ox - x0, oy - y0, r);
    if (c) {
      HG.state.tracking.target = c;
      // タップした位置＝そのとき運動体があった場所。追跡の出発点として覚えておく
      HG.state.tracking.seed = { x: ox, y: oy };
    }
    return c;
  }

  HG.tracker = { trackAll, clearAuto, pickColorAt, prepare };
})(window.HG = window.HG || {});
