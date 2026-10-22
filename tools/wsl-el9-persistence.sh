#!/usr/bin/env bash
set -uo pipefail
PORT=14517
inv(){ curl -s -m 25 -X POST http://127.0.0.1:$PORT/api/invoke -H 'Content-Type: application/json' -d "$2"; echo; }
echo "== 存一份非默认配置 =="
printf '  '; inv set '{"cmd":"save_stream_check_config","args":{"config":{"timeoutSecs":4,"maxRetries":1,"degradedThresholdMs":2500}}}'; echo
printf '  读回：'; inv get '{"cmd":"get_stream_check_config","args":{}}'
echo "== 重启容器（同一个匿名卷）=="
podman restart ccs-e2e >/dev/null
for i in $(seq 1 40); do [ -n "$(curl -s -m 2 http://127.0.0.1:$PORT/api/health)" ] && break; sleep 1; done
printf '  重启后读回：'; inv get '{"cmd":"get_stream_check_config","args":{}}'
printf '  重启后供应商还在：'; inv p '{"cmd":"get_providers","args":{"app":"claude"}}' | grep -o '"el9-local"' | head -1
echo "== 数据落在哪 =="
podman exec ccs-e2e sh -c 'ls -la /data 2>/dev/null | head -6; du -sh /data 2>/dev/null' | sed 's/^/  /'
echo "== 端口转发缺件假设 =="
rpm -q containernetworking-plugins passt 2>&1 | sed 's/^/  /'
