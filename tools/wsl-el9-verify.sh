#!/usr/bin/env bash
# 复用已在跑的 ccs-e2e 容器；先按秒等就绪，再把 Windows 侧那 10 项断言在 Linux 上重跑一遍。
set -uo pipefail
PORT=14517
for i in $(seq 1 40); do
  h=$(curl -s -m 2 http://127.0.0.1:$PORT/api/health)
  [ -n "$h" ] && break
  sleep 1
done
echo "== health =="; echo "  $h"
echo "== meta（Linux 侧 homeDir/os/arch）=="; printf '  '; curl -s -m 5 http://127.0.0.1:$PORT/api/meta; echo
inv(){ printf '%s\n  ' "$1"; curl -s -m 25 -X POST http://127.0.0.1:$PORT/api/invoke \
  -H 'Content-Type: application/json' -d "$2"; echo; }
inv "is_lightweight_mode" '{"cmd":"is_lightweight_mode","args":{}}'
inv "get_providers（Linux 首启种子数据）" '{"cmd":"get_providers","args":{"app":"claude"}}' | head -c 220; echo
inv "get_stream_check_config（读回上一轮存的 4/1/2500）" '{"cmd":"get_stream_check_config","args":{}}'
inv "update_toml_common_config_snippet" '{"cmd":"update_toml_common_config_snippet","args":{"configToml":"model = \"gpt\"\n\n[env]\nFOO = \"1\"\n","snippetToml":"[env]\nBAR = \"2\"\n","enabled":true}}'
echo "== 页面与打进二进制的资源 =="
curl -s -o /dev/null -w "  /           -> %{http_code} %{content_type} %{size_download}B\n" -m 5 http://127.0.0.1:$PORT/
for f in $(curl -s -m 5 http://127.0.0.1:$PORT/ | grep -o './assets/[A-Za-z0-9_.-]*'); do
  curl -s -o /dev/null -w "  $f -> %{http_code} %{size_download}B\n" -m 20 "http://127.0.0.1:$PORT/${f#./}"
done
echo "== 令牌门（对外监听时）=="
podman exec ccs-e2e sh -c 'echo' >/dev/null
printf '  无 token -> '; curl -s -o /dev/null -w '%{http_code}\n' -m 5 http://127.0.0.1:$PORT/api/health
echo "== 容器 =="; podman ps -a --filter name=ccs-e2e --format '{{.Names}} {{.Status}} {{.Ports}}' | sed 's/^/  /'
