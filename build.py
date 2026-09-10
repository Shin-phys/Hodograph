#!/usr/bin/env python3
"""
build.py — 配布用の1ファイル版を作る（任意。ふだんは不要）

index.html が読み込んでいる CSS / JS をそのまま埋め込んで
dist/index.html を書き出します。各 JS は名前空間 HG に載せるだけの
IIFE なので、読み込み順に連結すれば動作は変わりません。

  python3 build.py

使いどころ：
  ・USB や共有フォルダで1ファイルだけ配りたいとき
  ・ネットに繋がらない教室でオフラインで使いたいとき
ふだんの開発・GitHub Pages での公開は index.html のままでよい。
"""
import re, pathlib, html

ROOT = pathlib.Path(__file__).parent
src = (ROOT / "index.html").read_text(encoding="utf-8")

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def inline_css(m):
    href = m.group(1)
    return "<style>\n/* ==== " + href + " ==== */\n" + read(href) + "\n</style>"

def inline_js(m):
    src_path = m.group(1)
    body = read(src_path).replace("</script>", "<\\/script>")
    return "<script>\n/* ==== " + src_path + " ==== */\n" + body + "\n</script>"

out = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, src)
out = re.sub(r'<script src="([^"]+)"></script>', inline_js, out)

dist = ROOT / "dist"
dist.mkdir(exist_ok=True)
(dist / "index.html").write_text(out, encoding="utf-8")
print("wrote", dist / "index.html", f"({len(out)//1024} KB)")
