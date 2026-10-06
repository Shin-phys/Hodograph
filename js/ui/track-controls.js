/* =====================================================================
   ui/track-controls.js — 自動追跡の操作まわり（ステップ2と3）

   ポインタのモード（打点／色を指定／マーカーを指定）はここで切り替える。
   切り替えは HG.pointer.setHandler() の差し替えだけ。

   ★ 色選択は2段階にすること。★
   以前はタップ1回で確定していた。ルーペは長押し 280ms で出るので、
   素早くタップすると一度も出ず、**生徒は指で隠れた場所を見ないまま
   確定していた**。外したことが分かるのは追跡が失敗したとき。
   そこで④の Δv と同じ形にした：タップで照準を置く → 指でずらして
   微調整 → 「この色で決定」。ルーペはキャンバスの下の帯に出し、
   拾っている色のチップと色相・彩度を並べる（確定前に当たり外れが分かる）。

   色そのものは半径 1.2%（横1920なら23px）の円の色相平均で、灰色に近い
   画素は捨てている。**数ピクセルの精度は要らない。**
   問題は精度ではなく「何を拾ったか見えないまま確定する」ことだった。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  /* 色／マーカーを選んでいる最中の照準。{x, y, kind, color} 元解像度座標 */
  let aim = null;
  let picking = null;      // 'color' | 'marker' | null

  function hint(text) {
    const h = $('#hint');
    h.textContent = text;
    h.classList.remove('fade');
  }
  function hintDefault() {
    hint('画面をタップで打点／長押しでルーペ');
    if (HG.points.list().length) $('#hint').classList.add('fade');
  }

  function showColor() {
    const c = HG.state.tracking.target;
    $('#colorChip').style.background = HG.color.hsvToCss(c);
    HG.dom.text('#colorLabel', '色相 ' + c.h.toFixed(0) + '° ／ 彩度 ' + c.s.toFixed(2));
  }

  /* ---------- 2段階の位置選び（色／固定マーカー） ---------- */

  function startPick(kind) {
    aim = null;
    picking = kind;
    /* 色は動画の画素から読む。ストロボを出していると古いコマが残るので描き直す */
    try { HG.frames.drawToOffscreen(); } catch (e) { /* 動画が無ければ何もしない */ }
    HG.dom.show('#pickRow');
    HG.dom.text('#pickDecide', kind === 'color' ? 'この色で決定' : 'この位置で決定');
    hint(kind === 'color'
      ? '追いたいシールをタップ（そのあと指でずらして微調整できます）'
      : '動かない場所に貼ったシールをタップ（そのあとずらして微調整できます）');
    HG.pointer.setKeepBand(true);
    HG.pointer.setDownHandler(p => moveAim(p.ox, p.oy));   // 触れた瞬間から見える
    HG.pointer.setHandler(p => moveAim(p.ox, p.oy));
    HG.pointer.setPreview((from, p) => moveAim(p.ox, p.oy));
    HG.loupe.band(true);
    paintInfo();
  }

  function moveAim(ox, oy) {
    if (!picking) return;
    aim = { x: ox, y: oy, kind: picking };
    if (picking === 'color') aim.color = HG.tracker.sampleColorAt(ox, oy);
    /* 照準を描いてからルーペに写す。順序を逆にすると拡大像に照準が入らない */
    HG.stage.render();
    const c = HG.coords.toCanvas(ox, oy);
    HG.loupe.show({ cx: c.x, cy: c.y },
      { dock: true, keepBand: true, sampleR: HG.tracker.sampleRadius(), cross: false });
    paintInfo();
  }

  /** 帯の文字。確定前に当たり外れが分かることがこの機能の全部 */
  function paintInfo() {
    if (!picking) { HG.dom.html('#loupeInfo', ''); return; }
    if (!aim) {
      HG.dom.html('#loupeInfo', '<div class="sub">画面のシールをタップしてください。' +
        'ここに拡大して出るので、指で隠れません。</div>');
      return;
    }
    if (aim.kind === 'color') {
      HG.dom.html('#loupeInfo', aim.color
        ? '<span class="chip" style="background:' + HG.color.hsvToCss(aim.color) + '"></span> ' +
          '<span class="mono">色相 ' + aim.color.h.toFixed(0) + '° ／ 彩度 ' + aim.color.s.toFixed(2) + '</span>' +
          '<div class="sub">シールの色と合っていれば「この色で決定」。違えばずらしてください。</div>'
        : '<span class="warn">ここからは色が読めません（灰色に近すぎます）。</span>' +
          '<div class="sub">シールの中心へ寄せてください。</div>');
    } else {
      HG.dom.html('#loupeInfo',
        '<span class="mono">x ' + Math.round(aim.x) + ' ／ y ' + Math.round(aim.y) + '</span>' +
        '<div class="sub">動かないシールの中心に来ていれば「この位置で決定」。</div>');
    }
  }

  function endPick(commit) {
    if (commit && aim) {
      if (aim.kind === 'color') {
        const c = HG.tracker.pickColorAt(aim.x, aim.y);
        if (!c) {
          HG.dom.html('#loupeInfo', '<span class="warn">この位置では色を決められません。' +
            'シールの中心へ寄せてください。</span>');
          return;                                  // 選び直させる。閉じない
        }
        showColor();
        HG.dom.text('#trackResult', '色を指定しました。「自動追跡を実行」を押してください。');
      } else {
        HG.state.tracking.markerStart = { x: aim.x, y: aim.y };
        HG.dom.text('#trackResult', '固定マーカーを指定しました。追跡すると、このマーカーの変位を差し引きます。');
      }
    }
    aim = null; picking = null;
    HG.dom.hide('#pickRow');
    HG.pointer.setKeepBand(false);
    HG.pointer.setDownHandler(null);
    HG.pointer.setPreview(null);
    HG.loupe.hide();
    HG.controls.usePointHandler();
    hintDefault();
    if (HG.steps) HG.steps.render();
    HG.stage.render();
  }

  /** 照準（stage の painter として登録する） */
  function paintAim(ctx) {
    if (!aim) return;
    const dpr = HG.view.dpr;
    const c = HG.coords.toCanvas(aim.x, aim.y);
    const col = aim.kind === 'color' ? 'rgba(255,122,0,.95)' : 'rgba(255,210,0,.95)';
    ctx.save();
    /* 十字。中心は空けて、拾っている画素を隠さない */
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.lineWidth = 4 * dpr;
    for (let pass = 0; pass < 2; pass++) {
      if (pass) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; }
      ctx.beginPath();
      ctx.moveTo(c.x - 20 * dpr, c.y); ctx.lineTo(c.x - 6 * dpr, c.y);
      ctx.moveTo(c.x + 6 * dpr, c.y);  ctx.lineTo(c.x + 20 * dpr, c.y);
      ctx.moveTo(c.x, c.y - 20 * dpr); ctx.lineTo(c.x, c.y - 6 * dpr);
      ctx.moveTo(c.x, c.y + 6 * dpr);  ctx.lineTo(c.x, c.y + 20 * dpr);
      ctx.stroke();
    }
    /* 色を拾う円。1画素ではないことを見せる */
    const r = Math.max(6 * dpr, HG.tracker.sampleRadius() * HG.view.scale);
    ctx.setLineDash([5 * dpr, 5 * dpr]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /* ---------- ステップ3：追跡がうまくいったか ---------- */

  /**
   * 「いいえ」のときの助言。
   * **一律に「スライダーを低くしてください」とは言えない。**
   * 背景まで拾っている場合は逆（狭める・上げる）が正しく、
   * 下げろと言うと悪化する。report の中身で分ける。
   */
  function retryAdvice(r) {
    if (!r) return '追跡の記録がありません。もう一度「自動追跡を実行」を押してください。';
    if (r.maxMaskRatio > 0.5) {
      return '<b>色の範囲が広すぎて、背景まで拾っています。</b>' +
             '「色相の幅」を狭めるか、「彩度の下限」を上げてください。';
    }
    if (r.tracked === 0 || r.lost.length > r.total * 0.5) {
      return '<b>シールを見つけられていません。</b>「彩度の下限」を下げ、「色相の幅」を広げてみてください。' +
             'それでも合わなければ「追う色を指定」でシールの中心をもう一度選んでください。';
    }
    if (r.elongated > Math.max(1, r.total * 0.2)) {
      return '<b>シールが細長く写っています</b>（ブレているか、同じ色の背景とつながっています）。' +
             '「色相の幅」を狭めてください。直らなければスロー（120fps 以上）で撮り直すのが確実です。';
    }
    return '<b>「彩度の下限」を下げ、「色相の幅」を広げてみてください。</b>' +
           'それでも合わなければ「追う色を指定」でシールの中心をもう一度選んでください。';
  }

  function attach() {
    /* --- ステップ2：追う色と固定マーカー --- */
    $('#pickColor').onclick = () => startPick('color');
    $('#pickMarker').onclick = () => startPick('marker');
    $('#pickDecide').onclick = () => endPick(true);
    $('#pickCancel').onclick = () => endPick(false);

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

    /* --- ステップ3：実行 --- */
    $('#runTrack').onclick = run;
    $('#clearTrack').onclick = () => {
      HG.tracker.clearAuto();
      HG.dom.text('#trackResult', '追跡結果を消しました（手動打点は残っています）。');
      HG.dom.hide('#gotoLost');
      HG.dom.hide('#trackAskRow');
      HG.dom.hide('#trackAdvice');
      HG.diagnostics.render();
    };

    /* --- うまくいきましたか？ --- */
    $('#trackOk').onclick = () => {
      HG.dom.hide('#trackAskRow');
      HG.dom.hide('#trackAdvice');
      if (HG.steps) { HG.steps.render(); HG.steps.goTo('#selectCard'); }
    };
    $('#trackNg').onclick = () => {
      const r = HG.state.tracking.report;
      const advice = retryAdvice(r);
      /* **先に取り消すこと。** 失敗した点が残っていると、生徒はそれを
         直そうとして手で打ち始め、自動と手動が混ざった中途半端な結果になる。 */
      HG.tracker.clearAuto();
      HG.dom.hide('#trackAskRow');
      HG.dom.hide('#gotoLost');
      HG.dom.text('#trackResult', '追跡結果を取り消しました。設定を変えてもう一度実行してください。');
      HG.dom.html('#trackAdvice', advice);
      HG.dom.show('#trackAdvice');
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

    /* --- 手で打つカードを開いたら、そこへ連れて行く --- */
    const pc = $('#pointCard');
    if (pc) pc.addEventListener('toggle', () => {
      if (pc.open) pc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    showColor();
  }

  async function run() {
    const btn = $('#runTrack');
    btn.disabled = true;
    HG.dom.hide('#trackAskRow');
    HG.dom.hide('#trackAdvice');
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
    /* 数字では判断できない。**青丸が物体に乗っているかを見るのは生徒。**
       自動の見立て（見失い何コマ）を添えて、最後は目で決めてもらう。 */
    HG.dom.show('#trackAskRow');
    if (HG.steps) HG.steps.render();
  }

  HG.trackControls = { attach, hintDefault, paintAim };
})(window.HG = window.HG || {});
