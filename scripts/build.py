"""產生要部署的網頁。改完 src/ 之後執行： python3 scripts/build.py

  src/bead-studio.html  ─┬─▶ web/index.html   正式版
                         └─▶ web/ar.html      正式版 + ar.js（AR 測試版，搜尋引擎不收錄）
  src/ar.js             ───▶ web/ar.js

另外輸出 dist/artifact-ar.html：AR 版的單檔（ar.js 內嵌），給 Claude artifact 預覽用，不會部署。
推上 GitHub 時 Actions 也會自動跑這支程式，所以忘了跑也沒關係。"""
import pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, WEB, DIST = ROOT / 'src', ROOT / 'web', ROOT / 'dist'
page = (SRC / 'bead-studio.html').read_text(encoding='utf-8')
title_end = page.index('</title>') + len('</title>')
head, body = page[:title_end], page[title_end:]

def document(title_html, extra_head='', extra_body=''):
    return f'''<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{extra_head}{title_html}
<style>
:root{{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}
body{{margin:0}} img{{max-width:100%}} [hidden]{{display:none!important}}
</style>
<script src="config.js"></script>
</head>
<body>
{body}
{extra_body}</body>
</html>
'''

AR_TITLE = '<title>串珠盤 AR 測試版</title>'
WEB.mkdir(exist_ok=True)
(WEB / 'index.html').write_text(document(head), encoding='utf-8')
(WEB / 'ar.html').write_text(document(AR_TITLE, '<meta name="robots" content="noindex">\n',
                                      '<script src="ar.js"></script>\n'), encoding='utf-8')
shutil.copyfile(SRC / 'ar.js', WEB / 'ar.js')

DIST.mkdir(exist_ok=True)
ar_js = (SRC / 'ar.js').read_text(encoding='utf-8')
(DIST / 'artifact-ar.html').write_text(AR_TITLE + body + '\n<script>\n' + ar_js + '\n</script>\n', encoding='utf-8')
print('built: web/index.html, web/ar.html, web/ar.js, dist/artifact-ar.html')
