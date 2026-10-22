#!/usr/bin/env bash
# 这台机器到底哪里能直连 github：podman 容器（不带代理 env）与 WSL 宿主（清掉/带代理）。
# 目的：判断 podman build 加 --http-proxy=false 之后，git 依赖（github）会不会拉不到。
set -uo pipefail
URL=${1:-https://github.com}
NODE_JS='fetch(process.argv[1],{signal:AbortSignal.timeout(15000)}).then(r=>console.log("OK",r.status)).catch(e=>console.log("ERR",(e.cause&&(e.cause.code||e.cause.message))||e.message))'

echo "== 1. 容器（bridge，无代理 env）=="
podman run --rm docker.io/library/node:22.12.0-slim node -e "$NODE_JS" "$URL"

echo "== 2. WSL 宿主（清掉代理 env）=="
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
  curl -sS -m 15 -o /dev/null -w "  host-no-proxy=%{http_code}\n" "$URL" || echo "  host-no-proxy=FAILED"

echo "== 3. WSL 宿主（保留宿主代理，对照）=="
curl -sS -m 15 -o /dev/null -w "  host-with-proxy=%{http_code}\n" "$URL" || echo "  host-with-proxy=FAILED"
