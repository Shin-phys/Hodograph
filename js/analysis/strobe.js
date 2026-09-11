/* =====================================================================
   analysis/strobe.js — ストロボ画像の生成

   既定は「中央値背景 + 全画面差分」。これ一本で組む。
   「不変の背景の上に、動いたものだけが重なっていく」という方式で、
   何が動いているかを事前に指定する必要がない。「動いた」という事実
   だけで拾えるので、追跡できない対象（落ちる紙、跳ねる縄跳び、回るコマ、
   水滴）でもストロボ画像が作れる。

   処理の順序
     1. トリム区間から等間隔に 21 コマを抜き出す（連続コマは使わない。
        動きの遅い区間が続くと、そこで物体が背景に混ざる）
     2. 画素ごとに中央値を取って背景を作る（平均ではなく中央値。
        平均だと物体が薄く残る）
     3. 選ばれたコマだけ背景との差を計算し、閾値を超えた画素を重ねる
     4. 差分は RGB の単純差ではなく、輝度差と色差を分けて見る
        （影は輝度だけ変わって色相が変わらないので、分けると落としやすい）
     5. マスクに軽いモルフォロジー（収縮 → 膨張）をかけてノイズを消す

   二段構えのうちの「第二パス」。第一パス（座標と時刻）は済んでいる前提で、
   ここで初めて画像を触る。1000コマの動画でも、画像を持つのは十数コマだけ。
   ===================================================================== */
(function (HG) {
  'use strict';

  const BG_SAMPLES = 21;          // 背景推定に使うコマ数（奇数にして中央値を取りやすく）

  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas');
  const octx = out.getContext('2d');

  /** 取り込んだ画素のキャッシュ。閾値を動かしても取り込み直さない */
  const cache = {
    ready: false,
    w: 0, h: 0, scale: 1,          // scale: 元解像度 → 作業解像度
    bg: null,                      // Uint8Array(w*h*3)
    frames: [],                    // [{index, rgb:Uint8Array}]
    scores: null                   // [Float32Array] 各コマの差分スコア
  };

  function conf() { return HG.state.strobe; }

  /* ---------- 取り込み（第二パス） ---------- */

  function setupWork() {
    const W = HG.state.video.width, H = HG.state.video.height;
    const w = Math.min(W, conf().workWidth);
    cache.scale = w / W;
    cache.w = Math.round(w);
    cache.h = Math.round(H * cache.scale);
    work.width = cache.w; work.height = cache.h;
    out.width = cache.w; out.height = cache.h;
  }

  /** 固定マーカーのぶれを打ち消しながら作業キャンバスへ描く */
  function drawStabilized(index) {
    const marker = HG.state.refMarker || [];
    const base = (HG.state.tracking.useMarker ? marker.find(m => m && m.found) : null);
    let dx = 0, dy = 0;
    if (base) {
      const m = marker[index];
      if (m && m.found) { dx = (m.x - base.x) * cache.scale; dy = (m.y - base.y) * cache.scale; }
    }
    wctx.setTransform(1, 0, 0, 1, -dx, -dy);
    wctx.drawImage(HG.frames.offscreen, 0, 0, cache.w, cache.h);
    wctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  async function grab(index) {
    const fr = HG.state.frames, f = fr[index], nx = fr[index + 1];
    const eps = nx ? Math.min(0.004, (nx.t - f.t) * 0.4) : 0.004;
    await HG.frames.seekTo(f.t + eps);
    HG.frames.drawToOffscreen();
    drawStabilized(index);
    const d = wctx.getImageData(0, 0, cache.w, cache.h).data;
    const rgb = new Uint8Array(cache.w * cache.h * 3);
    for (let i = 0, k = 0, j = 0; i < cache.w * cache.h; i++, k += 4, j += 3) {
      rgb[j] = d[k]; rgb[j + 1] = d[k + 1]; rgb[j + 2] = d[k + 2];
    }
    return rgb;
  }

  /** 画素ごとの中央値（平均ではなく中央値。平均だと物体が薄く残る） */
  function medianStack(stack) {
    const n = stack.length, len = stack[0].length;
    const bg = new Uint8Array(len);
    const buf = new Uint8Array(n);
    const half = n >> 1;
    for (let p = 0; p < len; p++) {
      for (let s = 0; s < n; s++) buf[s] = stack[s][p];
      // 挿入ソート（n は 21 程度なのでこれで十分速い）
      for (let i = 1; i < n; i++) {
        const v = buf[i]; let j = i - 1;
        while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
        buf[j + 1] = v;
      }
      bg[p] = buf[half];
    }
    return bg;
  }

  /**
   * 背景と、選ばれたコマの画素を取り込む。
   * @param {number[]} selIndices 選ばれたコマ番号
   */
  async function capture(selIndices, onProgress) {
    setupWork();
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);
    const span = outI - inI;

    /* 1. 背景用に等間隔でコマを抜く（連続コマは使わない） */
    const bgIdx = [];
    const n = Math.min(BG_SAMPLES, span + 1);
    for (let k = 0; k < n; k++) bgIdx.push(inI + Math.round(span * k / Math.max(1, n - 1)));

    const stack = [];
    for (let k = 0; k < bgIdx.length; k++) {
      stack.push(await grab(bgIdx[k]));
      onProgress(k / bgIdx.length * 0.6);
    }

    /* 2. 中央値で背景を作る */
    cache.bg = medianStack(stack);
    stack.length = 0;                      // すぐ捨ててメモリを空ける

    /* 3. 選ばれたコマだけ取り込む */
    await grabSelected(selIndices, p => onProgress(0.6 + p * 0.4));
    cache.ready = true;
  }

  /**
   * 選ばれたコマだけを取り込み直す（背景はそのまま使い回す）。
   * 背景の中央値推定が重い（720p で数秒）のに対し、選択コマの取り込みは
   * 1〜2秒で済む。使うコマを変えるたびに作り直せるのはこのため。
   */
  async function grabSelected(selIndices, onProgress) {
    cache.frames = [];
    for (let k = 0; k < selIndices.length; k++) {
      cache.frames.push({ index: selIndices[k], rgb: await grab(selIndices[k]) });
      onProgress((k + 1) / Math.max(1, selIndices.length));
    }
    cache.scores = null;
  }

  /* ---------- 差分 ---------- */

  /**
   * 輝度差と色差を分けて見る。
   * 影は輝度だけ変わって色相が変わらないので、色差を重く見ると落としやすい。
   * 重みは経験値。変えるときはここだけ触ればよい。
   */
  const W_CHROMA = 2.0, W_LUMA = 0.35;

  function scoreFrame(rgb) {
    const bg = cache.bg, len = cache.w * cache.h;
    const s = new Float32Array(len);
    for (let i = 0, j = 0; i < len; i++, j += 3) {
      const r = rgb[j], g = rgb[j + 1], b = rgb[j + 2];
      const R = bg[j], G = bg[j + 1], B = bg[j + 2];
      const Y  = 0.299 * r + 0.587 * g + 0.114 * b;
      const Yb = 0.299 * R + 0.587 * G + 0.114 * B;
      const dCb = (b - Y) - (B - Yb);
      const dCr = (r - Y) - (R - Yb);
      s[i] = Math.min(255, Math.sqrt(dCb * dCb + dCr * dCr) * W_CHROMA + Math.abs(Y - Yb) * W_LUMA);
    }
    return s;
  }

  function ensureScores() {
    if (cache.scores) return;
    cache.scores = cache.frames.map(f => scoreFrame(f.rgb));
  }

  /**
   * 大津の判別分析法で閾値の初期値を決める。
   * 差分値のヒストグラムは、背景（差ゼロ付近の巨大な山）と物体（小さな裾）に
   * 分かれるので、これで自動決定できる。ただし教室の照明条件は予測できない
   * ので、必ずスライダも出すこと。
   */
  function otsu() {
    ensureScores();
    const hist = new Float64Array(256);
    let total = 0;
    cache.scores.forEach(s => {
      for (let i = 0; i < s.length; i += 3) { hist[s[i] | 0]++; total++; }
    });
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > bestVar) { bestVar = v; best = t; }
    }
    return Math.max(6, best);
  }

  /* ---------- モルフォロジー（収縮 → 膨張）でノイズの点々を消す ---------- */
  function open(mask, w, h) {
    const a = new Uint8Array(mask.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        a[i] = (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) ? 1 : 0;
      }
    }
    const b = new Uint8Array(mask.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        b[i] = (a[i] || a[i - 1] || a[i + 1] || a[i - w] || a[i + w] ||
                a[i - w - 1] || a[i - w + 1] || a[i + w - 1] || a[i + w + 1]) ? 1 : 0;
      }
    }
    return b;
  }

  /* ---------- 合成 ---------- */

  /**
   * @param opt {method:'diff'|'cutout'|'lighten', threshold, fadeOld, cutoutRadius}
   * @returns {HTMLCanvasElement}
   */
  function compose(opt) {
    const len = cache.w * cache.h;
    const img = octx.createImageData(cache.w, cache.h);
    const o = img.data;
    for (let i = 0, j = 0, k = 0; i < len; i++, j += 3, k += 4) {
      o[k] = cache.bg[j]; o[k + 1] = cache.bg[j + 1]; o[k + 2] = cache.bg[j + 2]; o[k + 3] = 255;
    }

    const n = cache.frames.length;
    const alphaOf = k => opt.fadeOld ? (0.35 + 0.65 * (n > 1 ? k / (n - 1) : 1)) : 1;

    if (opt.method === 'lighten') {
      /* 比較明合成：暗幕の前で明るい物体、という条件が作れるなら一番きれい */
      cache.frames.forEach(f => {
        const s = f.rgb;
        for (let i = 0, j = 0, k = 0; i < len; i++, j += 3, k += 4) {
          if (s[j] > o[k]) o[k] = s[j];
          if (s[j + 1] > o[k + 1]) o[k + 1] = s[j + 1];
          if (s[j + 2] > o[k + 2]) o[k + 2] = s[j + 2];
        }
      });
    } else if (opt.method === 'cutout') {
      /* 座標周辺の円だけを貼る。閾値も背景推定も要らないので絶対に破綻しない。
         背景差分がどうしても破綻する動画のための退避先。既定にはしない。 */
      const R = Math.max(4, opt.cutoutRadius * cache.scale);
      cache.frames.forEach((f, k) => {
        const fr = HG.state.frames[f.index];
        if (!fr || !fr.found) return;
        const cx = fr.x * cache.scale, cy = fr.y * cache.scale, a = alphaOf(k);
        const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(cache.w - 1, Math.ceil(cx + R));
        const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(cache.h - 1, Math.ceil(cy + R));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > R * R) continue;
            const i = y * cache.w + x, j = i * 3, kk = i * 4;
            o[kk]     = o[kk]     * (1 - a) + f.rgb[j] * a;
            o[kk + 1] = o[kk + 1] * (1 - a) + f.rgb[j + 1] * a;
            o[kk + 2] = o[kk + 2] * (1 - a) + f.rgb[j + 2] * a;
          }
        }
      });
    } else {
      /* 既定：中央値背景 + 全画面差分 */
      ensureScores();
      cache.frames.forEach((f, k) => {
        const s = cache.scores[k];
        const mask = new Uint8Array(len);
        for (let i = 0; i < len; i++) mask[i] = s[i] >= opt.threshold ? 1 : 0;
        const m = open(mask, cache.w, cache.h);
        const a = alphaOf(k);
        for (let i = 0, j = 0, kk = 0; i < len; i++, j += 3, kk += 4) {
          if (!m[i]) continue;
          o[kk]     = o[kk]     * (1 - a) + f.rgb[j] * a;
          o[kk + 1] = o[kk + 1] * (1 - a) + f.rgb[j + 1] * a;
          o[kk + 2] = o[kk + 2] * (1 - a) + f.rgb[j + 2] * a;
        }
      });
    }

    octx.putImageData(img, 0, 0);
    return out;
  }

  /** マスクの占有率（診断用）。画面のほとんどが「動いた」なら露出が動いている */
  function maxMaskRatio(threshold) {
    ensureScores();
    let max = 0;
    cache.scores.forEach(s => {
      let c = 0;
      for (let i = 0; i < s.length; i += 3) if (s[i] >= threshold) c++;
      max = Math.max(max, c / (s.length / 3));
    });
    return max;
  }

  function clear() {
    cache.ready = false; cache.bg = null; cache.frames = []; cache.scores = null;
  }

  HG.strobe = { capture, grabSelected, compose, otsu, clear, cache, maxMaskRatio, canvas: () => out };
})(window.HG = window.HG || {});
