#!/usr/bin/env bash
# 在 CentOS 9 宿主上用 podman 跑无头镜像（--network=host，绕开缺件的端口转发栈），
# 验证 Linux 首启、API、移植命令与页面资源。
set -uo pipefail
PORT=14517
podman rm -f ccs-e2e >/dev/null 2>&1 || true
podman run -d --name ccs-e2e --cgroup-manager=cgroupfs --network=host \
  -e CC_SWITCH_DATA_DIR=/data localhost/cc-switch-server:dev \
  --bind 127.0.0.1 --port $PORT >/dev/null
for i in $(seq 1 60); do curl -s -m 1 http://127.0.0.1:$PORT/api/health >/dev/null 2>&1 && break; done

echo "== health =="; curl -s -m 5 http://127.0.0.1:$PORT/api/health; echo
echo "== meta（Linux homeDir/os/arch）=="; curl -s -m 5 http://127.0.0.1:$PORT/api/meta; echo
inv(){ printf '%s\n  ' "$1"; curl -s -m 25 -X POST http://127.0.0.1:$PORT/api/invoke \
  -H 'Content-Type: application/json' -d "$2"; echo; }
inv "is_lightweight_mode" '{"cmd":"is_lightweight_mode","args":{}}'
inv "get_providers（首启种子数据）" '{"cmd":"get_providers","args":{"app":"claude"}}'
inv "移植命令 save_stream_check_config" '{"cmd":"save_stream_check_config","args":{"config":{"timeoutSecs":4,"maxRetries":1,"degradedThresholdMs":2500}}}'
inv "移植命令 get_stream_check_config" '{"cmd":"get_stream_check_config","args":{}}'

echo "== 页面与资源 =="
curl -s -o /dev/null -w "  /           -> %{http_code} %{content_type} %{size_download}B\n" -m 5 http://127.0.0.1:$PORT/
JS=$(curl -s -m 5 http://127.0.0.1:$PORT/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s -o /dev/null -w "  /$JS -> %{http_code} %{size_download}B\n" -m 15 "http://127.0.0.1:$PORT/$JS"
CSS=$(curl -s -m 5 http://127.0.0.1:$PORT/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.css' | head -1)
curl -s -o /dev/null -w "  /$CSS -> %{http_code} %{size_download}B\n" -m 15 "http://127.0.0.1:$PORT/$CSS"

echo "== 镜像内嵌页面 vs 本地 dist-legacy（逐字节）=="
SV=$(curl -s -m 20 "http://127.0.0.1:$PORT/$JS" | md5sum | cut -d' ' -f1)
LO=$(md5sum "/mnt/d/projects/ccs/dist-legacy/$JS" | cut -d' ' -f1)
echo "  served=$SV"
echo "  local =$LO"
[ "$SV" = "$LO" ] && echo "  PAGE-MATCH=yes" || echo "  PAGE-MATCH=no"
curl -s -m 20 "http://127.0.0.1:$PORT/$JS" -o /tmp/ccs-container.js
echo -n "  新文案命中数（zh/zh-TW/ja/en，期望各 1）: "
for s in 'v4 计费不使用' '預設倍率（v4 計費不使用）' 'デフォルト倍率（v4 課金では未使用）' 'unused in v4 billing'; do
  printf '%s=%s ' "$s" "$(grep -o "$s" /tmp/ccs-container.js | wc -l)"
done; echo
rm -f /tmp/ccs-container.js

echo "== 倍率两条命令（Linux 容器侧证据）=="
inv "get_default_cost_multiplier" '{"cmd":"get_default_cost_multiplier","args":{"appType":"claude"}}'
inv "set_default_cost_multiplier=2.5" '{"cmd":"set_default_cost_multiplier","args":{"appType":"claude","value":"2.5"}}'
inv "get_default_cost_multiplier（期望 2.5）" '{"cmd":"get_default_cost_multiplier","args":{"appType":"claude"}}'
inv "set_default_cost_multiplier=-1（期望本地化报错）" '{"cmd":"set_default_cost_multiplier","args":{"appType":"claude","value":"-1"}}'

echo "== 事件桥（SSE 帧）=="
(python3 -m http.server 18099 --bind 127.0.0.1 >/dev/null 2>&1 &) ; sleep 1
inv "add_provider(指向 WSL 本地探针)" '{"cmd":"add_provider","args":{"app":"claude","provider":{"id":"el9-local","name":"EL9 Local","settingsConfig":{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:18099"}},"inFailoverQueue":false},"addToLive":false}}'
inv "stream_check_all_providers" '{"cmd":"stream_check_all_providers","args":{"appType":"claude","proxyTargetsOnly":false}}'
PID=$(inv "create_profile" '{"cmd":"create_profile","args":{"name":"el9-sse","scope":"claude"}}' | tr -d '\n' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
(curl -s -N -m 12 "http://127.0.0.1:$PORT/api/events" > /tmp/el9-sse.txt 2>&1 &) ; sleep 1
inv "apply_profile" "{\"cmd\":\"apply_profile\",\"args\":{\"id\":\"$PID\",\"scope\":\"claude\"}}"
sleep 3; echo "  SSE 帧:"; grep '^data:' /tmp/el9-sse.txt | sed 's/^/    /'
# 上面为 stream_check 起的 WSL 本地探针服务不关掉会一直占着 18099
pkill -f "http.server 18099" >/dev/null 2>&1 || true
echo "== 容器状态 =="; podman ps --filter name=ccs-e2e --format '{{.Names}} {{.Status}}' | sed 's/^/  /'
