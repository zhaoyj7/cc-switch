#!/usr/bin/env bash
# CentOS Stream 9 到底能不能自己编 tauri 2 无头版：
# 1) glib2 有没有 >= 2.70 的来源；2) webkit2gtk-4.1 的 pc 文件在不在；
# 3) 有没有 podman（EL9 默认带，可以不开 docker 就用 Debian 容器编）。
set -uo pipefail

echo "== 容器工具 =="
for c in podman docker buildah; do printf "  %-8s " "$c"; command -v $c >/dev/null && $c --version 2>&1 | head -1 || echo "无"; done

echo "== 已装的 webkit / gtk 开发包 =="
rpm -qa | grep -Ei "webkit|gtk3|glib2|soup" | sort

echo "== pkg-config 里现有的相关模块 =="
for p in glib-2.0 gobject-2.0 gio-2.0 gtk+-3.0 webkit2gtk-4.0 webkit2gtk-4.1 javascriptcore-4.0 javascriptcore-4.1 libsoup-2.4 libsoup-3.0; do
  printf "  %-22s " "$p"; pkg-config --modversion "$p" 2>/dev/null || echo MISS
done

echo "== webkit2gtk3-devel 提供了哪些 .pc =="
rpm -ql webkit2gtk3-devel 2>/dev/null | grep -E "\.pc$" || echo "  未安装"

echo "== glib2 在本机仓库里的可选版本 =="
dnf -q --showduplicates list available glib2 2>/dev/null | awk '/glib2/{print "  "$2" "$3" "$4}' | sort -u | tail -8
echo "  已装: $(rpm -q glib2 2>/dev/null)"

echo "== 仓库里有没有 4.1 的 webkit 包 =="
dnf -q list available 'webkit*' 2>/dev/null | awk 'NR>1{print "  "$1}' | sort -u
dnf -q repoquery --whatprovides 'pkg-config(webkit2gtk-4.1)' 2>/dev/null | sed 's/^/  4.1-provider: /' | head -5

echo "== 启用的仓库 / 有没有 EPEL 或 extra repos 文件 =="
dnf -q repolist 2>/dev/null | sed 's/^/  /'
ls -1 /etc/yum.repos.d/ | sed 's/^/  repo: /'
