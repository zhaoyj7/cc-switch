#!/usr/bin/env bash
# Linux 服务器上跑无头版要先确认：tauri 在 Linux 硬性依赖 gtk3 + webkit2gtk-4.1，
# 这些 -devel 包在当前发行版里能不能装、有没有 docker 可以换发行版编译。
set -uo pipefail
echo "== distro =="
cat /etc/os-release | grep -E "^(NAME|VERSION)=" 
echo "== docker =="
command -v docker >/dev/null && docker --version || echo "no docker"
echo "== dnf 里可装的 webkit / gtk 开发包 =="
dnf -q list available 'webkit*' 'gtk3-devel' 'glib2-devel' 2>&1 | grep -Ei "webkit|gtk3-devel|glib2-devel" | head -20
echo "== 已装的 pkg-config 模块 =="
for p in glib-2.0 gtk+-3.0 webkit2gtk-4.1 webkit2gtk-4.0 javascriptcore-6.0 libsoup-3.0 libsoup-2.4; do
  printf "  %-20s " "$p"; pkg-config --modversion "$p" 2>/dev/null || echo MISS
done
