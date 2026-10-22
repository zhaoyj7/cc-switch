#!/usr/bin/env bash
# 构建 EL9 原生可执行文件（容器里编、链接期用 EL9 的 glibc），拷到宿主并做 verneed 检查。
set -uo pipefail
cd /mnt/d/projects/ccs
echo "== podman build -f deploy/Dockerfile.el9-native =="
# --http-proxy=false：podman build 默认会把宿主的 http(s)_proxy 注进构建步骤，
# 而 WSL 宿主那个 127.0.0.1:7890 在容器 netns 里根本不存在 → pnpm/cargo 全线 ECONNREFUSED。
# 容器直连 registry/crates.io 实测是通的（tools/wsl-npm-egress-probe.sh 第 1 组 = 200）。
podman build --cgroup-manager=cgroupfs --http-proxy=false -f deploy/Dockerfile.el9-native \
  -t localhost/cc-switch-server:el9 . > /root/ccs-el9-native.log 2>&1
st=$?
echo "build-status=$st"
tail -30 /root/ccs-el9-native.log
[ "$st" -ne 0 ] && exit "$st"

podman rm -f ccs-el9-ex >/dev/null 2>&1
podman create --name ccs-el9-ex localhost/cc-switch-server:el9 >/dev/null 2>&1
mkdir -p /root/ccs-deploy
podman cp ccs-el9-ex:/cc-switch-server /root/ccs-deploy/cc-switch-server-el9
podman rm ccs-el9-ex >/dev/null 2>&1
ls -l --time-style=full-iso /root/ccs-deploy/cc-switch-server-el9
sha256sum /root/ccs-deploy/cc-switch-server-el9

echo "== 版本需求（不该再出现 GLIBC_2.35）=="
readelf -V /root/ccs-deploy/cc-switch-server-el9 | awk '/Version needs/{f=1} f' | grep -E 'File:|Name:' | paste - -
echo "== hypot 引用 =="
readelf --dyn-syms -W /root/ccs-deploy/cc-switch-server-el9 | grep -i hypot
