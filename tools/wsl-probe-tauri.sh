#!/usr/bin/env bash
# 查 tauri / tauri-runtime 在 Linux 上到底把 gtk+webkit 挂在什么条件下。
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
for c in tauri-2.12.4 tauri-runtime-2.12.2 muda-0.20.0; do
  d=$(find "$HOME/.cargo/registry/src" -maxdepth 2 -type d -name "$c" | head -1)
  echo "########## $c  ($d)"
  [ -z "$d" ] && continue
  awk '/^\[target\..*\.(dependencies|dev-dependencies)\]/{print "\n--- "$0; next} /^\[/{print "\n--- "$0; next} {print}' "$d/Cargo.toml" \
    | grep -A 12 -E "cfg\(unix|cfg\(linux|target_os = \"linux\"" | grep -vE "^--$" | head -40
done
echo "########## tauri features 里与 gtk/webkit/runtime 相关的行"
d=$(find "$HOME/.cargo/registry/src" -maxdepth 2 -type d -name "tauri-2.12.4" | head -1)
grep -nE "^(wry|tray-icon|common-controls-v6|protocol-asset|image-png|dbus|x11|dynamic-acl|webkit|gtk)" "$d/Cargo.toml" | head -30
