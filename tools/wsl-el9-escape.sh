#!/usr/bin/env bash
set -uo pipefail
echo "== podman 是否可装 =="
dnf -q list available podman podman-docker 2>&1 | grep -Ei "podman|Error|No matching" | head -5
echo "== 所有仓库里带 webkit2gtk-4.1 的包 =="
dnf -q repoquery --whatprovides 'pkg-config(webkit2gtk-4.1)' 2>&1 | head -5
dnf -q list available 'webkit2gtk4*' 'webkitgtk4*' 2>&1 | grep -Ei "webkit|No matching" | head -5
echo "== 有没有更新的 glib2 来源（含 EPEL） =="
dnf -q --showduplicates --enablerepo='*' list available glib2 2>/dev/null | awk '/glib2/{print "  "$3}' | sort -uV | tail -3
echo "== flatpak-runtime / module 之类的替代 glib =="
dnf -q list available 'flatpak*' 'mingw64-glib2' 2>/dev/null | grep -Ei "glib|flatpak" | head -3
