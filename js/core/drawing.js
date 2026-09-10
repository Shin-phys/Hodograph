/* =====================================================================
   core/drawing.js — 作図データ（描画も UI も持たない）

   時刻の半コマずれ（実装上の最重要事項）

     位置    r₀      r₁      r₂      r₃      r₄
     速度       v₀.₅    v₁.₅    v₂.₅    v₃.₅
     加速度         a₁      a₂      a₃

   ②で先端同士を結んだ矢印は r_k と r_{k+1} の中間時刻の速度を表す。
   ④の Δv はその中間時刻同士のさらに中間、つまり元のコマの位置に対応する。

   したがって配列の対応は
     velocityVectors[k] … r_k → r_{k+1}（中間時刻 k+0.5 の速度）
     deltaVVectors[k]   … v_{k+0.5} → v_{k+1.5} の差 ＝ 位置 r_{k+1} の加速度
   ⑥で描き戻す先は r_k ではなく **r_{k+1}**。ここを間違えると矢印が
   1コマぶんずれた位置に描かれる。posIndexOfDeltaV() を必ず使うこと。
   ===================================================================== */
(function (HG) {
  'use strict';

  /** 作図の対象になるコマ（選択され、かつ座標があるもの） */
  function pts() {
    return HG.selection.list().filter(f => f.found);
  }

  function reset() {
    const d = HG.state.drawing;
    d.origin = null;
    d.positionVectors = [];
    d.velocityVectors = [];
    d.deltaVVectors = [];
  }

  /** Δv の番号 k に対応する位置ベクトルの番号（半コマずれの対応表） */
  function posIndexOfDeltaV(k) { return k + 1; }

  /* --- 自動算出。加速度は定量計算せず、速度ベクトルの先端同士を結んだものとする --- */
  function autoPosition(k) {
    const p = pts(), o = HG.state.drawing.origin;
    if (!o || !p[k]) return null;
    return { dx: p[k].x - o.x, dy: p[k].y - o.y };
  }
  function autoVelocity(k) {
    const p = pts();
    if (!p[k] || !p[k + 1]) return null;
    return { dx: p[k + 1].x - p[k].x, dy: p[k + 1].y - p[k].y };
  }
  function autoDeltaV(k) {
    const a = autoVelocity(k), b = autoVelocity(k + 1);
    if (!a || !b) return null;
    return { dx: b.dx - a.dx, dy: b.dy - a.dy };
  }

  /** 生徒が描いたものがあればそれを、無ければ自動算出を返す */
  function velocity(k) { return HG.state.drawing.velocityVectors[k] || autoVelocity(k); }
  function deltaV(k) { return HG.state.drawing.deltaVVectors[k] || autoDeltaV(k); }

  /* --- 書き込み --- */
  function setOrigin(x, y) { HG.state.drawing.origin = { x: x, y: y }; }
  function putPosition(k, v) { HG.state.drawing.positionVectors[k] = v; }
  function putVelocity(k, v) { HG.state.drawing.velocityVectors[k] = v; }
  function putDeltaV(k, v) { HG.state.drawing.deltaVVectors[k] = v; }

  /** ①②の「残りを自動で描く」。全部を手描きさせると集中力を使い切る */
  function fillPositions() {
    const p = pts();
    for (let k = 0; k < p.length; k++) {
      if (!HG.state.drawing.positionVectors[k]) {
        HG.state.drawing.positionVectors[k] = autoPosition(k);
      }
    }
  }
  function fillVelocities() {
    const p = pts();
    for (let k = 0; k < p.length - 1; k++) {
      if (!HG.state.drawing.velocityVectors[k]) {
        HG.state.drawing.velocityVectors[k] = autoVelocity(k);
      }
    }
  }

  function counts() {
    const p = pts(), d = HG.state.drawing;
    const filled = a => a.filter(v => v).length;
    return {
      n: p.length,
      pos: filled(d.positionVectors), posNeed: p.length,
      vel: filled(d.velocityVectors), velNeed: Math.max(0, p.length - 1),
      dv: filled(d.deltaVVectors), dvNeed: Math.max(0, p.length - 2)
    };
  }

  /**
   * ⑤の答え合わせ。判定は向き中心。
   * 数値で出すと、単位もスケールも違うものを並べることになり、
   * ズレの原因が作図なのか計算なのか分からなくなる。
   * @returns {{deg:number, ok:boolean}|null}
   */
  function angleError(k, tolerance) {
    const mine = HG.state.drawing.deltaVVectors[k], ref = autoDeltaV(k);
    if (!mine || !ref) return null;
    const la = Math.hypot(mine.dx, mine.dy), lb = Math.hypot(ref.dx, ref.dy);
    if (la < 1e-6 || lb < 1e-6) return null;
    let c = (mine.dx * ref.dx + mine.dy * ref.dy) / (la * lb);
    c = Math.max(-1, Math.min(1, c));
    const deg = Math.acos(c) * 180 / Math.PI;
    return { deg: deg, ok: deg <= (tolerance === undefined ? 15 : tolerance) };
  }

  HG.drawing = {
    pts, reset, counts, posIndexOfDeltaV,
    autoPosition, autoVelocity, autoDeltaV,
    velocity, deltaV,
    setOrigin, putPosition, putVelocity, putDeltaV,
    fillPositions, fillVelocities, angleError
  };
})(window.HG = window.HG || {});
