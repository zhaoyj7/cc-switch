#!/usr/bin/env bash
# 方案 3 探针：在 Debian 12 构建容器里，把 -L 指向 EL9 宿主的 glibc，
# 看链接器是否会因此不再记录 GLIBC_2.35 版本需求（LD_PRELOAD 已证明消不掉 verneed）。
set -eux

mkdir -p /link /out
cp /el9lib/libm.so.6 /link/libm.so
cp /el9lib/libc.so.6 /link/libc.so
ls -l /link

cat > /tmp/t.rs <<'EOF'
fn main() {
    // 3e300.hypot(4e300) 必须靠缩放算法才不溢出，能打印 5e300 说明实现是对的
    println!("hypot={:.1e}", 3e300_f64.hypot(4e300));
}
EOF

rustc -C opt-level=2 -C link-arg=-L/link -o /out/hypot-test /tmp/t.rs

echo "== 版本需求 =="
readelf -V /out/hypot-test | awk '/Version needs/{f=1} f' | grep -E 'File:|Name:' | paste - -
echo "== 是否仍有 GLIBC_2.35 需求（期望：没有）=="
readelf -V /out/hypot-test | grep -c 'GLIBC_2.35' || true
echo "== hypot 引用 =="
readelf --dyn-syms -W /out/hypot-test | grep -i hypot || true
echo "== 容器内自测 =="
/out/hypot-test
