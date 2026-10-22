#!/usr/bin/env bash
# 抠出二进制里"到底哪个符号要 GLIBC_2.35"，以及运行期真正 NEEDED 的库清单。
set -uo pipefail
BIN=/root/cc-switch-server-el9
echo "== DT_NEEDED =="
readelf -d "$BIN" | grep -E "NEEDED|RPATH|RUNPATH" | sed 's/^/  /'
echo "== 需要 GLIBC_2.35 的未定义符号 =="
objdump -T "$BIN" 2>/dev/null | awk '/GLIBC_2\.3[5-9]/' | head -20
echo "== 所有 GLIBC 版本需求分布 =="
objdump -T "$BIN" 2>/dev/null | grep -oE "GLIBC_[0-9.]+" | sort -uV | sed 's/^/  /'
echo "== 宿主 glibc =="
ldd --version | head -1
