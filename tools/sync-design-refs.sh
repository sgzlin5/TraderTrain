#!/usr/bin/env bash
# 拉取 financial-ui-suite 的设计规则（纯 markdown，无构建依赖）
# 用法：bash tools/sync-design-refs.sh
set -eu
cd "$(dirname "$0")/.."
OUT="docs/design/financial-ui-suite"
TMP="$(mktemp -d)"
git clone --depth 1 -q https://github.com/rgourley/financial-ui-suite.git "$TMP/fus"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$TMP/fus/skills/." "$OUT/"
cp "$TMP/fus/LICENSE" "$OUT/LICENSE" 2>/dev/null || true
rm -rf "$TMP"
echo "synced -> $OUT ($(find "$OUT" -name '*.md' | wc -l) markdown files)"
