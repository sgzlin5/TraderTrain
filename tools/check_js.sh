#!/usr/bin/env bash
# 语法体检：所有 ES 模块逐个用 node 解析（import 语法也能过）
# 用法：bash tools/check_js.sh
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
for f in app/src/*.js app/vendor/*.js; do
  [ -e "$f" ] || continue
  if ! node --input-type=module --check < "$f" 2>/tmp/_check_err; then
    echo "FAIL $f"
    sed -n '1,6p' /tmp/_check_err
    fail=1
  fi
done
# 重复顶层声明检查（function/const/let 同名会直接 SyntaxError，但这里单列一次以防 node 版本差异）
for f in app/src/*.js; do
  dup=$(grep -oE '^(export )?(async )?function [A-Za-z0-9_$]+' "$f" | awk '{print $NF}' | sort | uniq -d)
  if [ -n "$dup" ]; then
    echo "DUP $f: $(echo "$dup" | tr '\n' ' ')"
    fail=1
  fi
done
[ "$fail" = 0 ] && echo "ALL OK ($(ls app/src/*.js | wc -l) files)"
exit "$fail"
