#!/usr/bin/env bash
# TraderTrain exe 构建脚本（Windows / git-bash）
#   用法：
#     bash packaging/build.sh                  # 默认：不带历史数据（清单为空），给外部测试
#     WITH_DATA=1 bash packaging/build.sh      # 把 data/bin 一起打进包（+108 MB，本机演示用）
#     VER=0.2.1 bash packaging/build.sh        # 换版本号（记得同步 trader_train.py 的 VERSION）
set -e
cd "$(dirname "$0")"

VER="${VER:-0.2.0-beta}"
WITH_DATA="${WITH_DATA:-0}"
PY="py -3.12"

echo "== 1) 生成 BUILD 戳 =="
STAMP="$VER+$(date +%Y%m%d-%H%M)"
printf '%s\n' "$STAMP" > ../app/BUILD
echo "   app/BUILD = $STAMP"

echo "== 2) 行情数据 =="
EXTRA=()
if [ "$WITH_DATA" = "1" ]; then
  [ -d ../data/bin ] || { echo "   data/bin 不存在，无法 WITH_DATA=1"; exit 1; }
  echo "   WITH_DATA=1 → 内置 data/bin（$(du -sh ../data/bin | cut -f1)）"
  EXTRA+=(--add-data "../data/bin;data/bin" --add-data "../data/manifest.json;data")
else
  echo "   不内置历史：启动时扫描盘上的 data/bin（exe 同级 / TT_DATA / 仓库 / 用户目录），扫到啥就能导入啥"
fi

echo "== 3) 准备打包 venv（PyInstaller 对 3.14 支持滞后，用 3.12）=="
if [ ! -x ".venv/Scripts/python.exe" ]; then
  $PY -m venv .venv
fi
./.venv/Scripts/python.exe -m pip install -q --upgrade pip
./.venv/Scripts/python.exe -m pip install -q pywebview 'pyinstaller==6.22.3' cffi

echo "== 4) PyInstaller =="
rm -rf build dist 2>/dev/null || true    # Windows 上 dist 常被资源管理器/杀软占着句柄，删不掉就让 PyInstaller 覆盖
./.venv/Scripts/python.exe -m PyInstaller \
  --onefile --noconsole --clean --noconfirm \
  --name "TraderTrain-$VER" \
  --icon ../app/assets/icon.ico \
  --add-data "../app;app" \
  --add-data "../tools/serve.py;tools" \
  --add-data "../tools/make_manifest.py;tools" \
  --add-data "../tools/fixtures;tools/fixtures" \
  "${EXTRA[@]}" \
  --collect-all pythonnet \
  --collect-all clr_loader \
  --hidden-import clr \
  --hidden-import webview.platforms.edgechromium \
  --exclude-module numpy --exclude-module pandas --exclude-module matplotlib \
  --exclude-module PyQt5 --exclude-module PySide2 --exclude-module tkinter \
  --exclude-module test --exclude-module pydoc \
  trader_train.py 2>&1 | tail -6

echo "== 4) 附带说明 =="
cp README-EXE.txt "dist/README-EXE.txt"
ls -la dist
echo "== done: packaging/dist/TraderTrain-$VER.exe =="
