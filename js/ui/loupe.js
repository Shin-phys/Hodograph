/* =====================================================================
   ui/loupe.js — ルーペ（指先で隠れる位置を正確に指すための拡大表示）

   指先は画面を隠すため、縦画面でストロボ画像上の黒点を正確に指すのは
   困難。長押しすると指の少し上に拡大表示が出て、正確な位置を確認して
   から離せる。この機能の有無でスマホでの作図が実用になるかが決まる。
   実装は canvas の一部を拡大コピーして小さな円に描くだけ。
   ===================================================================== */
(function (HG) {
  'use strict';

  const D = 260;      // ルーペの内部解像度
  const ZOOM = 2.6;
  let el = null, ctx = null;

  function attach(canvas) {
    el = canvas;
    ctx = el.getContext('2d');
  }

  /** @param p {cx, cy} キャンバス実ピクセルでの指の位置 */
  function show(p) {
    const cv = HG.stage.canvas();
    const r = cv.getBoundingClientRect();
    /* ルーペの位置は #stage を基準に置くので、キャンバスが中央寄せで
       ずれているぶんを足す（高さ制限で幅が余ることがある） */
    const host = cv.parentElement.getBoundingClientRect();
    const offX = r.left - host.left, offY = r.top - host.top;
    const cssX = offX + p.cx / (cv.width / r.width);
    const cssY = offY + p.cy / (cv.height / r.height);

    el.style.display = 'block';
    el.style.width = (D / 2) + 'px';
    el.style.height = (D / 2) + 'px';
    let lx = cssX - D / 4;
    let ly = cssY - D / 2 - 42;          // 指の少し上に出す
    if (ly < 4) ly = cssY + 24;          // 上端では下に逃がす
    lx = Math.max(2, Math.min(host.width - D / 2 - 2, lx));
    /* 下端でも枠からはみ出さないようにする */
    if (host.height) ly = Math.max(2, Math.min(host.height - D / 2 - 2, ly));
    el.style.left = lx + 'px';
    el.style.top = ly + 'px';

    ctx.save();
    ctx.clearRect(0, 0, D, D);
    ctx.beginPath();
    ctx.arc(D / 2, D / 2, D / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, D, D);
    /* 取り込む範囲がキャンバスの外へ出たら、出たぶんだけ描く先もずらす。
       範囲をそのまま drawImage へ渡すと、ブラウザが元と先を比例して切るため、
       拡大像が円の中で片側へ寄り、たとえば画面の下側を触ったときにルーペの
       下半分が空になる（実機で指摘された）。
       こうしておけば、中心の十字は常に指している点そのものを指す。 */
    const s = D / ZOOM;
    const sx = p.cx - s / 2, sy = p.cy - s / 2;
    const ax = Math.max(0, sx), ay = Math.max(0, sy);
    const bx = Math.min(cv.width, sx + s), by = Math.min(cv.height, sy + s);
    if (bx > ax && by > ay) {
      ctx.drawImage(cv, ax, ay, bx - ax, by - ay,
        (ax - sx) * ZOOM, (ay - sy) * ZOOM, (bx - ax) * ZOOM, (by - ay) * ZOOM);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(D / 2 - 18, D / 2); ctx.lineTo(D / 2 - 4, D / 2);
    ctx.moveTo(D / 2 + 4, D / 2);  ctx.lineTo(D / 2 + 18, D / 2);
    ctx.moveTo(D / 2, D / 2 - 18); ctx.lineTo(D / 2, D / 2 - 4);
    ctx.moveTo(D / 2, D / 2 + 4);  ctx.lineTo(D / 2, D / 2 + 18);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(D / 2, D / 2, D / 2 - 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2; ctx.stroke();
  }

  function hide() { if (el) el.style.display = 'none'; }

  HG.loupe = { attach, show, hide };
})(window.HG = window.HG || {});
