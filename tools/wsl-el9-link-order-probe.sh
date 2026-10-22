#!/usr/bin/env bash
# 定位：为什么 rustc 直连探针生效了，cargo 构建却没生效。
# 在 Debian 容器里用一个最小 cargo 项目复现同样的链接路径。
set -x
mkdir -p /link && cp /el9lib/libc.so.6 /link/libc.so && cp /el9lib/libm.so.6 /link/libm.so
ls -l /usr/lib/x86_64-linux-gnu/libm.so /usr/lib/x86_64-linux-gnu/libc.so
file /usr/lib/x86_64-linux-gnu/libm.so
head -5 /usr/lib/x86_64-linux-gnu/libm.so 2>/dev/null || true

cargo new /t --bin >/dev/null
printf 'fn main(){ println!("hypot={:.1e}", 3e300_f64.hypot(4e300)); }\n' > /t/src/main.rs

cd /t
echo "=== A. 不加 -L（基线）==="
cargo build --release -q && readelf -V target/release/t | grep -oE 'GLIBC_[0-9.]+' | sort -uV | tail -4
echo "=== B. 加 RUSTFLAGS=-C link-arg=-L/link（模拟 Dockerfile.el9-native）==="
rm -rf target
RUSTFLAGS="-C link-arg=-L/link" cargo build --release -q
readelf -V target/release/t | grep -oE 'GLIBC_[0-9.]+' | sort -uV | tail -4
readelf --dyn-syms -W target/release/t | grep -i hypot

echo "=== C. 覆盖 Debian 的 libm.so 链接脚本，强制 -lm 指向 EL9 ==="
cp /usr/lib/x86_64-linux-gnu/libm.so /tmp/libm.so.orig
printf 'GROUP ( /link/libm.so )\n' > /usr/lib/x86_64-linux-gnu/libm.so
rm -rf target
cargo build --release -q
readelf -V target/release/t | grep -oE 'GLIBC_[0-9.]+' | sort -uV | tail -4
readelf --dyn-syms -W target/release/t | grep -i hypot
cp /tmp/libm.so.orig /usr/lib/x86_64-linux-gnu/libm.so
