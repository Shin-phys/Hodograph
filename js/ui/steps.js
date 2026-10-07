/* =====================================================================
   ui/steps.js — 解析のステップ帯（1〜6）

   操作の順序はアプリが決める。生徒が10枚のカードを前にして
   「次はどれ？」と止まるのを防ぐのが目的。

   ★ 進み具合は state から毎回求める（持たない）。★
   「ステップ3まで終わった」をフラグで覚えると、生徒が追跡結果を消したり
   トリムをやり直したりしたときに表示だけ先に進んだままになる。
   state から求めれば、どこを触っても必ず実際の状態と一致する。

   カードは隠さない。畳むと教師が行き来できなくなるし、加速度探究モードは
   「使うコマ」と結果を同時に見るのが本体なので、隠す設計と両立しない。
   番号を振り、押せば飛ぶ帯を置くところまでにしてある。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  const STEPS = [
    { n: 1, label: 'トリム',   lead: '解析に使う区間を決める',   card: '#trimCard'   },
    { n: 2, label: '追う色',   lead: '追う色を決める',           card: '#markCard'   },
    { n: 3, label: '自動追跡', lead: '自動で追跡する',           card: '#trackCard'  },
    { n: 4, label: '使うコマ', lead: '使うコマを決める',         card: '#selectCard' },
    { n: 5, label: 'ストロボ', lead: 'ストロボ画像をつくる',     card: '#strobeCard' },
    { n: 6, label: '作図',     lead: '作図する',                 card: '#drawCard'   }
  ];

  function isStrobeOnly() { return document.body.classList.contains('mode-strobe'); }
  function isExplore() { return document.body.classList.contains('mode-explore'); }

  /** そのモードで使うステップだけ返す */
  function list() {
    if (isStrobeOnly()) return STEPS.filter(s => s.n === 1 || s.n === 4 || s.n === 5);
    if (isExplore()) {
      return STEPS.map(s => s.n === 6
        ? { n: 6, label: '加速度', lead: '加速度ベクトルを描く', card: '#exploreCard' } : s);
    }
    return STEPS;
  }

  /**
   * そのステップが済んでいるか。state だけから求める。
   *
   * ★ ✓ は「アプリに値が入っている」ではなく「生徒が見て決めた」に付けること。★
   * trim.outIndex は走査が終わった時点でアプリが末尾を入れるので、それで
   * 判定すると**動画を読み込んだ直後に1の ✓ が付く**（実機で指摘された）。
   * 同じ理由で3は点の数では判定しない。外れた追跡でも点は並ぶ。
   */
  function done(n) {
    const st = HG.state;
    if (!st.frames.length) return false;
    if (n === 1) return !!st.trim.userSet;
    if (n === 2) return !!st.tracking.seed || !!HG.points.list().length;
    if (n === 3) {
      if (HG.points.list().length < 3) return false;
      /* 追跡を走らせたなら「うまくいきましたか？」に答えてもらう。
         手で打っただけ（走らせていない）なら、点が揃っていれば済んだ扱い。 */
      return st.tracking.report ? !!st.tracking.verified : true;
    }
    if (n === 4) return HG.selection.isActive() && HG.selection.list().length >= 3;
    if (n === 5) return HG.strobe.cache.ready;
    if (n === 6) return HG.draw.state.step >= 5;
    return false;
  }

  /** いま案内すべきステップ（最初の未完了） */
  function current() {
    const ls = list();
    for (const s of ls) if (!done(s.n)) return s.n;
    return ls[ls.length - 1].n;
  }

  function render() {
    const el = $('#stepNav');
    if (!el) return;
    const ls = list();
    const cur = current();
    HG.dom.html('#stepNav', ls.map(s => {
      /* 済んだものは必ず ✓。全部済んだときに最後が「now」で光り続けると、
         まだ何か残っているように見える。 */
      const cls = done(s.n) ? 'step ok' : s.n === cur ? 'step now' : 'step';
      return '<button class="' + cls + '" data-card="' + s.card + '">' +
             '<b>' + s.n + '</b> ' + s.label + '</button>';
    }).join(''));

    /* いまやること。番号を並べるだけでは「どれが次か」は色でしか分からず、
       最初の1手（トリック）へ向かう動線が無かった。1行だけ、押せる形で出す。
       全部済んだら消す（残っていると、まだ何かあるように見える）。 */
    const now = ls.filter(s => s.n === cur && !done(s.n))[0];
    const line = $('#stepNow');
    if (!line) return;
    line.classList.toggle('hide', !now);
    if (now) {
      HG.dom.html('#stepNow',
        '<button class="stepnow-btn" data-card="' + now.card + '">つぎは ' +
        '<b>' + now.n + '. ' + now.lead + '</b> →</button>');
    }
  }

  /**
   * そのカードへ飛ぶ。
   *
   * ★ scrollIntoView をそのまま使わないこと。★
   * 狭い画面ではキャンバスの列（.col-main）を画面の上に貼り付けているので、
   * カードの頭を画面の上端に合わせると**貼り付いたキャンバスの下に潜る**。
   * 見出しが隠れて、別のところへ飛ばされたように見える（実機で指摘された）。
   * 貼り付いている高さぶん手前で止める。
   */
  function goTo(sel) {
    const card = document.querySelector(sel);
    if (!card) return;
    /* 畳んである（手で打つ など）なら開いてから飛ぶ。開く前に位置を測ると
       畳んだままの高さで計算してしまうので、開くのが先。 */
    if (card.tagName === 'DETAILS') card.open = true;
    const main = document.querySelector('.col-main');
    const stuck = (window.innerWidth < 900 && main)
      ? main.getBoundingClientRect().height : 0;
    const y = card.getBoundingClientRect().top + window.pageYOffset - stuck - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  function attach() {
    const jump = e => {
      const b = e.target.closest('[data-card]');
      if (b) goTo(b.dataset.card);
    };
    $('#stepNav').onclick = jump;
    if ($('#stepNow')) $('#stepNow').onclick = jump;
    ['trim:changed', 'points:changed', 'selection:changed', 'selection:committed',
     'strobe:made', 'frames:scanned'].forEach(ev => HG.bus.on(ev, render));
    render();
  }

  HG.steps = { attach, render, goTo, current, done };
})(window.HG = window.HG || {});
