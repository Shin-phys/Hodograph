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
    { n: 1, label: 'トリム',   card: '#trimCard'   },
    { n: 2, label: '追う色',   card: '#markCard'   },
    { n: 3, label: '自動追跡', card: '#trackCard'  },
    { n: 4, label: '使うコマ', card: '#selectCard' },
    { n: 5, label: 'ストロボ', card: '#strobeCard' },
    { n: 6, label: '作図',     card: '#drawCard'   }
  ];

  function isStrobeOnly() { return document.body.classList.contains('mode-strobe'); }
  function isExplore() { return document.body.classList.contains('mode-explore'); }

  /** そのモードで使うステップだけ返す */
  function list() {
    if (isStrobeOnly()) return STEPS.filter(s => s.n === 1 || s.n === 4 || s.n === 5);
    if (isExplore()) {
      return STEPS.map(s => s.n === 6
        ? { n: 6, label: '加速度', card: '#exploreCard' } : s);
    }
    return STEPS;
  }

  /** そのステップが済んでいるか。state だけから求める */
  function done(n) {
    const st = HG.state;
    if (!st.frames.length) return false;
    if (n === 1) return st.trim.outIndex !== null;
    if (n === 2) return !!st.tracking.seed || !!HG.points.list().length;
    if (n === 3) return HG.points.list().length >= 3;
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
    const cur = current();
    HG.dom.html('#stepNav', list().map(s => {
      /* 済んだものは必ず ✓。全部済んだときに最後が「now」で光り続けると、
         まだ何か残っているように見える。 */
      const cls = done(s.n) ? 'step ok' : s.n === cur ? 'step now' : 'step';
      return '<button class="' + cls + '" data-card="' + s.card + '">' +
             '<b>' + s.n + '</b> ' + s.label + '</button>';
    }).join(''));
  }

  function goTo(sel) {
    const card = document.querySelector(sel);
    if (!card) return;
    /* 畳んである（手で打つ など）なら開いてから飛ぶ */
    if (card.tagName === 'DETAILS') card.open = true;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function attach() {
    $('#stepNav').onclick = e => {
      const b = e.target.closest('[data-card]');
      if (b) goTo(b.dataset.card);
    };
    ['trim:changed', 'points:changed', 'selection:changed', 'selection:committed',
     'strobe:made', 'frames:scanned'].forEach(ev => HG.bus.on(ev, render));
    render();
  }

  HG.steps = { attach, render, goTo, current, done };
})(window.HG = window.HG || {});
