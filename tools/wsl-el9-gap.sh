#!/usr/bin/env bash
# 在 CentOS Stream 9 宿主上精确测量：Debian 12 容器产出的无头二进制到底缺什么。
BIN=${1:-/root/ccs-deploy/cc-switch-server}
echo "== host =="
grep PRETTY /etc/os-release
rpm -q glib2 gtk3 glibc 2>&1
echo "== ldd missing =="
ldd "$BIN" 2>&1 | grep -E 'not found|version.*not found' || echo "  (none)"
echo "== DT_NEEDED =="
readelf -d "$BIN" 2>/dev/null | grep NEEDED | sed 's/.*\[/  /;s/\]//'
echo "== 版本需求（verneed 原始行）=="
readelf -V "$BIN" 2>/dev/null | awk '/Version needs/{f=1} f' | head -200
echo "== 需要 GLIBC_2.35 及以上的具体动态符号 =="
readelf --dyn-syms -W "$BIN" 2>/dev/null | grep -E 'GLIBC_(2\.3[5-9]|2\.[4-9][0-9]|3\.[0-9]+)'
echo "== 真实 exec =="
out=$("$BIN" --help 2>&1); rc=$?
echo "$out" | head -3
echo "EXIT_EXEC=$rc"
