#!/usr/bin/env bash
# 版本需求之外，逐个核对未定义符号能否在 EL9 宿主的 so 里找到。
# ldd 遇到 GLIBC_2.35 就整体报错退出，不逐个报符号，所以这里手工比对。
BIN=${1:-/root/ccs-deploy/cc-switch-server}
readelf --dyn-syms -W "$BIN" 2>/dev/null | grep ' UND ' | sed 's/.* //' | sed 's/@.*//' | grep -v '^$' | sort -u > /tmp/und.txt
echo "UND 符号数: $(wc -l < /tmp/und.txt)"
: > /tmp/have.txt
for n in $(readelf -d "$BIN" 2>/dev/null | grep NEEDED | sed 's/.*\[\(.*\)\]/\1/'); do
  p=$(ldconfig -p | grep -F "$n" | head -1 | sed 's/.*=> //')
  [ -z "$p" ] && p="/lib64/$n"
  if [ ! -f "$p" ]; then echo "MISSING LIB: $n"; continue; fi
  nm -D --defined-only "$p" 2>/dev/null | awk '{print $NF}' >> /tmp/have.txt
done
sort -u /tmp/have.txt -o /tmp/have.txt
echo "宿主 so 导出符号数: $(wc -l < /tmp/have.txt)"
comm -23 /tmp/und.txt /tmp/have.txt > /tmp/miss.txt
echo "== 宿主找不到的 UND 符号: $(wc -l < /tmp/miss.txt) 个 =="
cat /tmp/miss.txt
