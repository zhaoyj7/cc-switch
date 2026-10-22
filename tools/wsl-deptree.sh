#!/usr/bin/env bash
# 无头构建里谁把 gtk/glib 拉进依赖树（用于把桌面专属依赖挡在 headless 之外）。
set -euo pipefail
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"
cd /mnt/d/projects/ccs/src-tauri
cargo tree --no-default-features --features headless \
  -e normal --config 'http.proxy=""' 2>/dev/null \
  | grep -E "glib|gtk|gio-sys|webkit2gtk|pango|cairo|atk|soup|javascriptcore" \
  | sed 's/^ *//' | sort -u
echo "=== 反向定位 glib ==="
cargo tree --no-default-features --features headless -i glib -e normal 2>/dev/null | head -30
