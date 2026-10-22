#!/usr/bin/env bash
# 诊断：容器里到底能不能拿到 npm registry（bridge / host / host+代理 三种网络）
set -uo pipefail

JS='fetch("https://registry.npmjs.org/-/ping")
  .then(r => console.log("OK", r.status))
  .catch(e => console.log("ERR", (e.cause && (e.cause.code || e.cause.message)) || e.message));'

IMG=docker.io/library/node:22.12.0-slim

echo "== 1. bridge（podman 默认，也就是这次构建失败时用的）=="
podman run --rm "$IMG" node -e "$JS"
echo "exit=$?"

echo "== 2. --network=host =="
podman run --rm --network=host "$IMG" node -e "$JS"
echo "exit=$?"

echo "== 3. --network=host + HTTPS_PROXY=127.0.0.1:7890 =="
podman run --rm --network=host \
  -e HTTPS_PROXY=http://127.0.0.1:7890 -e HTTP_PROXY=http://127.0.0.1:7890 \
  -e NO_PROXY=127.0.0.1,localhost \
  "$IMG" node -e "$JS"
echo "exit=$?"

echo "== 4. 宿主机自己（对照）=="
node -e "$JS" 2>/dev/null || curl -sS -m 15 -o /dev/null -w "curl host=%{http_code}\n" https://registry.npmjs.org/-/ping
echo "宿主 env: https_proxy=${https_proxy:-<空>} HTTP_PROXY=${HTTP_PROXY:-<空>}"
