/* =====================================================================
   main.js — 起動と、イベント → 再描画の配線

   「誰がいつ再描画するか」はここだけを見れば分かるようにしてある。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  /** 画面まわりをまとめて更新する */
  function refresh() {
    HG.stage.render();
    HG.timeline.draw();
    HG.controls.updateLabels();
  }
  HG.refresh = refresh;

  function say(msg, cls) {
    HG.dom.html('#loadState', cls ? '<span class="' + cls + '">' + msg + '</span>' : msg);
  }

  /* ---------- 動画の受け取り ---------- */
  function wireUpload() {
    const drop = $('#drop');
    $('#pick').onclick = () => $('#file').click();
    $('#file').onchange = e => { if (e.target.files[0]) start(e.target.files[0]); };

    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.add('hot');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.remove('hot');
    }));
    drop.addEventListener('drop', e => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) start(f);
    });

    /* 同梱のお手本動画。50分の授業で「撮影→追跡→作図→議論」は入らないし、
       撮影が失敗しても授業が止まらない保険になる。 */
    $('#sampleBtn').onclick = () => {
      const p = HG.state.preset;
      if (!p) return;
      /* data: URI を優先する。file:// で素のパスを読むと canvas が汚染されて
         画素が読めなくなる（追跡もストロボもできない）。 */
      const embedded = HG.samples && p.sampleKey && HG.samples[p.sampleKey];
      if (embedded) start(embedded);
      else if (p.sample) start(p.sample);
    };

    /* ホームへ戻る。読み込んだ動画・追跡結果・作図をすべて捨てるので、
       状態を中途半端に残さないよう読み込み直す（タイルの画面から始まる） */
    $('#goHome').onclick = () => {
      const dirty = HG.state.frames.length > 0;
      if (dirty && !confirm('最初の画面（運動を選ぶ）に戻ります。\n読み込んだ動画と、追跡・作図の結果は消えます。よろしいですか？')) return;
      location.reload();
    };

    /* ストロボ画像を作りに来た生徒が、ベクトル作図に入る入口 */
    $('#goVectors').onclick = () => {
      document.body.classList.remove('mode-strobe');
      HG.dom.hide('#toVectors');
      HG.dom.text('#trackResult', 'シールをタップして色を指定し、「自動追跡を実行」を押すと座標が取れます。');
      $('#trackCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  /** 撮影の向きがプリセットと合っているか（二次元は横、バネは縦が自然） */
  function checkOrientation() {
    const p = HG.state.preset;
    if (!p || !p.orientation) return '';
    const landscape = HG.state.video.width >= HG.state.video.height;
    if (p.orientation === 'landscape' && !landscape) return 'この運動は横向きで撮ると見やすくなります。';
    if (p.orientation === 'portrait' && landscape) return 'この運動は縦向きで撮ると見やすくなります。';
    return '';
  }

  async function start(file) {
    const vid = $('#vid');
    say('読み込み中…');
    HG.dom.show('#vid');
    HG.dom.hide('#cv');

    const res = await HG.loader.load(file, vid);
    if (!res.ok) {
      /* 何が起きたかを必ず添える。以前は原因の違う3つを同じ文面で
         片付けていて、しかも「撮影した端末で開いてください」と案内していた。
         撮影した端末（iPhone）で開いている人には、打つ手が無い文面だった。 */
      const pr = HG.state.video.probe;
      const detail = pr && pr.log && pr.log.length
        ? '<br><span class="mono sub">調べた結果：' + pr.log.join(' ／ ') + '</span>' : '';
      const msg =
        res.reason === 'taint'
          ? 'この開き方（file://）では、この動画の画素を読み取れません。' +
            '「動画を選ぶ」から読み込むか、GitHub Pages などサーバー経由で開いてください。'
        : res.reason === 'black'
          ? '動画は開けましたが、調べた3か所がどれも真っ黒でした。' +
            '暗い場面から始まる動画なら、明るいところが写っている部分を含めて撮り直すと通ります。' +
            'スロー撮影の動画は先頭が暗いことがあります。'
        : res.reason === 'draw'
          ? '動画は開けましたが、コマを画像として取り出せませんでした。' +
            'ページを再読み込みしてもう一度お試しください。' +
            '繰り返すようなら、写真アプリでその動画を一度「複製」してから、複製のほうを選んでみてください' +
            '（スロー撮影の動画は、複製すると通常の形式で書き出されることがあります）。'
        : 'この動画を開けませんでした。ファイルが大きすぎるか、対応していない形式の可能性があります。';
      say(msg + detail, 'warn');
      return;
    }

    HG.wakelock.request();

    /* 全コマの実時刻を走査（第一パス。画像は保存しない） */
    const bar = $('#scanBar');
    HG.dom.show('#scanBar');
    say('コマの実時刻を記録しています…（動画を1回通しで再生します）');
    const n = await HG.scanner.scan(p => {
      bar.firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    });
    HG.dom.hide('#scanBar');

    if (n < 2) { say('コマを取得できませんでした。別の動画で試してください。', 'warn'); return; }
    if (HG.ui.timebase !== 'rvfc') {
      say('この環境では requestVideoFrameCallback が使えません。コマ送りで時刻を推定しました。', 'warn');
    }

    vid.pause();
    HG.dom.hide('#vid');
    HG.dom.show('#cv');
    HG.dom.hide('#screen1');
    HG.dom.show('#screen2');
    const warn = checkOrientation();
    if (warn) HG.dom.html('#strobeInfo', '<span class="warn">' + warn + '</span>');
    HG.frames.showFrame(0);
    window.scrollTo(0, 0);
  }

  /* ---------- 配線 ---------- */
  function boot() {
    HG.stage.attach($('#cv'));
    HG.loupe.attach($('#loupe'));
    HG.timeline.attach($('#tl'));
    HG.pointer.attach($('#cv'));
    /* painter の登録順＝描く順。あとから登録したものが上に乗る */
    HG.stage.register(HG.draw.paintFade);          // ストロボを薄くする層
    HG.stage.register(HG.selection.drawPreview);   // 加速度プレビュー
    HG.stage.register(HG.overlay.drawPoints);
    HG.stage.register(HG.overlay.drawMarker);
    HG.stage.register(HG.draw.paint);              // 作図の矢印
    HG.controls.attach();
    HG.trackControls.attach();
    HG.selection.attach();
    HG.strobeControls.attach();
    HG.draw.attach();
    HG.prediction.attach();
    HG.tiles.attach();
    wireUpload();

    HG.bus.on('frame:changed', refresh);
    HG.bus.on('points:changed', () => {
      refresh();
      if (HG.points.list().length) $('#hint').classList.add('fade');   // 最初の打点で操作ヒントを引っ込める
    });
    HG.bus.on('view:changed', refresh);
    HG.bus.on('trim:changed', () => { refresh(); HG.diagnostics.render(); });
    HG.bus.on('frames:scanned', () => HG.diagnostics.render());
    HG.bus.on('strobe:made', () => {
      if (document.body.classList.contains('mode-strobe')) HG.dom.show('#toVectors');
    });

    /* 追跡や打点で座標が増えたら、ストロボ画像のキャッシュは作り直しになる */
    HG.bus.on('points:changed', () => {
      if (HG.strobe.cache.ready) {
        HG.strobe.clear();
        HG.stage.setSource(null);
        HG.dom.hide('#strobeAfter');
        HG.dom.text('#strobeInfo', '座標が変わったので、ストロボ画像は作り直してください。');
        HG.stage.render();
      }
    });

    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(refresh, 150);
    });
    window.addEventListener('orientationchange', () => setTimeout(refresh, 300));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.HG = window.HG || {});
