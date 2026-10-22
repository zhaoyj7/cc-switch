#!/usr/bin/env bash
# 无头构建在 Linux 上的系统依赖体检：只看 pkg-config 能不能找到。
set -u
echo "pkg-config: $(pkg-config --version 2>&1 | head -1)"
for p in webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 javascriptcore-6.0 xcb xkbcommon openssl; do
  if pkg-config --modversion "$p" >/dev/null 2>&1; then
    echo "  OK    $p $(pkg-config --modversion "$p")"
  else
    echo "  MISS  $p"
  fi
done
echo "cc: $(command -v cc || echo none)"
echo "HOME=$HOME  CARGO_HOME=${CARGO_HOME:-$HOME/.cargo}"
