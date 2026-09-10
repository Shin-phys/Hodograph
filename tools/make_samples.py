#!/usr/bin/env python3
"""
tools/make_samples.py — samples/*.webm を js/presets/samples.js に埋め込む

なぜ埋め込むのか：
  file:// で開いたページから <video src="samples/xxx.webm"> を読むと、
  canvas が「汚染」されて getImageData が使えなくなる（追跡もストロボも
  できない）。data: URI なら汚染されないので、ダブルクリックで開いても
  お手本が動く。GitHub Pages 経由なら素のパスでも問題ない。

使い方：
  samples/ に動画を置いて  python3 tools/make_samples.py
  ファイル名（拡張子なし）が、presets.js の sampleKey になる。

注意：
  埋め込むと元のおよそ 1.33 倍のサイズが JS に乗る。数 MB の実写動画を
  何本も入れると重くなるので、お手本は短く小さく作ること
  （数秒・720p 以下で十分）。
"""
import base64, pathlib, mimetypes

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "samples"
OUT = ROOT / "js" / "presets" / "samples.js"

entries = []
total = 0
for f in sorted(SRC.glob("*")):
    if f.suffix.lower() not in (".webm", ".mp4", ".mov"):
        continue
    mime = mimetypes.guess_type(f.name)[0] or "video/webm"
    data = base64.b64encode(f.read_bytes()).decode("ascii")
    total += len(data)
    entries.append('    "%s": "data:%s;base64,%s"' % (f.stem, mime, data))

body = """/* 自動生成ファイル。編集しないこと。
   tools/make_samples.py が samples/ から作ります。 */
(function (HG) {
  'use strict';
  HG.samples = {
%s
  };
})(window.HG = window.HG || {});
""" % (",\n".join(entries))

OUT.write_text(body, encoding="utf-8")
print("wrote", OUT, "(%d KB, %d 本)" % (len(body) // 1024, len(entries)))
