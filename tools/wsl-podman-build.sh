#!/usr/bin/env bash
set -uo pipefail
cd /mnt/d/projects/ccs
echo "== podman build (context = 仓库根，.dockerignore 生效) =="
# --http-proxy=false 的原因见 tools/wsl-el9-native-build.sh 顶部注释
podman build --cgroup-manager=cgroupfs --http-proxy=false -f deploy/Dockerfile -t localhost/cc-switch-server:dev . \
  > /root/ccs-podman-build.log 2>&1
st=$?
echo "build-status=$st"
tail -30 /root/ccs-podman-build.log
[ "$st" -ne 0 ] && exit "$st"
