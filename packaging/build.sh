#!/usr/bin/env bash
# TraderTrain v0.1 exe 构建脚本（Windows / git-bash）
#   用法： bash packaging/build.sh
set -e
cd "$(dirname "$0")"

VER=0.1.0
PY="py -3.12"

echo "== 1) 生成 BUILD 戳 =="
STAMP="$VER+$(date +%Y%m%d-%H%M)"
printf '%s\n' "$STAMP" > ../app/BUILD
echo "   app/BUILD = $STAMP"

echo "== 2) 准备打包 venv（PyInstaller 对 3.14 支持滞后，用 3.12）=="
if [ ! -x ".venv/Scripts/python.exe" ]; then
  $PY -m venv .venv
fi
./.venv/Scripts/python.exe -m pip install -q --upgrade pip
./.venv/Scripts/python.exe -m pip install -q pywebview pyinstaller

echo "== 3) PyInstaller =="
rm -rf build dist
./.venv/Scripts/python.exe -m PyInstaller \
  --onefile --noconsole --clean --noconfirm \
  --name "TraderTrain-$VER" \
  --icon ../app/assets/icon.ico \
  --add-data "../app;app" \
  --add-data "../data/manifest.json;data" \
  --add-data "../tools/serve.py;tools" \
  --add-data "../tools/fixtures;tools/fixtures" \
  trader_train.py 2>&1 | tail -6

echo "== 4) 附带说明 =="
cp README-EXE.txt "dist/README-EXE.txt"
ls -la dist
echo "== done: packaging/dist/TraderTrain-$VER.exe =="
