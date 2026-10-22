#!/usr/bin/env bash
# Fedora 35 能否作为 CentOS 9 原生单二进制的构建工具链：
# 需要 glibc 2.34（=EL9）+ glib>=2.70（gtk-rs 0.18 下限）+ webkit2gtk-4.1 开发包。
set -x
W41=$(dnf -q repoquery --qf '%{name}\n' --whatprovides 'pkg-config(webkit2gtk-4.1)' 2>/dev/null | sort -u | head -3)
if [ -z "$W41" ]; then W41=$(dnf -q provides 'pkg-config(webkit2gtk-4.1)' 2>/dev/null | grep -o '^[a-z0-9._-]*\.x86_64' | sed 's/\.x86_64//' | sort -u | head -3); fi
echo "PROVIDES_WEBKIT_4_1=$W41"
dnf -q list available '*webkit*' 2>&1 | head -20
if [ -z "$W41" ]; then echo "F35 has no webkit2gtk-4.1 provider, trying 4.0"; W41=webkitgtk4-devel; fi
# shellcheck disable=SC2086
dnf -y install gcc pkg-config gtk3-devel $W41 2>&1 | tail -12
echo "EXIT_DNF=$?"
pkg-config --modversion gtk+-3.0    || echo "gtk3: none"
pkg-config --modversion glib-2.0    || echo "glib: none"
pkg-config --modversion webkit2gtk-4.1 || echo "webkit2gtk-4.1: none"
