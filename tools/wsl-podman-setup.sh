#!/usr/bin/env bash
set -uo pipefail
if ! command -v podman >/dev/null; then
  echo "== dnf install podman =="
  dnf -q install -y podman 2>&1 | tail -5
fi
podman --version
echo "== 试拉最小镜像（探测 registry 连通性）=="
podman pull docker.io/library/debian:bookworm-slim 2>&1 | tail -4
