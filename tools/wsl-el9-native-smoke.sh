#!/usr/bin/env bash
# EL9 原生二进制的功能冒烟：**不套容器**，直接跑在 CentOS Stream 9 宿主上。
# 覆盖：进程能起 / health+meta / 内嵌页面字节与本地构建一致 / 一条移植命令的读写往返（证明 DB 正常）。
set -uo pipefail
BIN=${1:-/root/ccs-deploy/cc-switch-server-el9}
DATA=/tmp/ccs-el9-native-data
PORT=${2:-14521}
invoke() { curl -s -m 8 -X POST "http://127.0.0.1:$PORT/api/invoke" \
  -H 'content-type: application/json' -d "$1"; }

rm -rf "$DATA"; mkdir -p "$DATA"
"$BIN" --bind 127.0.0.1 --port "$PORT" --data-dir "$DATA" > /tmp/ccs-el9-native.log 2>&1 &
PID=$!
# 首次启动要跑数据库迁移，慢，别用快速重试
ready=no
for _ in $(seq 1 90); do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ready=yes; break; fi
  sleep 1
done
echo "ready=$ready  alive=$(kill -0 $PID 2>/dev/null && echo yes || echo no)"

echo "== health =="; curl -s -m 3 "http://127.0.0.1:$PORT/api/health"; echo
echo "== meta ==";   curl -s -m 3 "http://127.0.0.1:$PORT/api/meta";   echo
echo "== index 字节数（宿主侧）=="; curl -s -m 5 "http://127.0.0.1:$PORT/" | wc -c
echo "== index 字节数（本地构建）=="; wc -c < /mnt/d/projects/ccs/dist-legacy/index.html
echo "== index md5 对比 =="
curl -s -m 5 "http://127.0.0.1:$PORT/" | md5sum
md5sum /mnt/d/projects/ccs/dist-legacy/index.html

echo "== get_stream_check_config（v3 移植命令）=="
invoke '{"cmd":"get_stream_check_config","args":{}}'; echo
echo "== save_stream_check_config 往返 =="
invoke '{"cmd":"save_stream_check_config","args":{"config":{"timeoutSecs":11,"maxRetries":2,"degradedThresholdMs":3333}}}'; echo
invoke '{"cmd":"get_stream_check_config","args":{}}'; echo
echo "（期望上一步读回 11/2/3333，说明原生跑的 SQLite 写入正常）"

echo "== 倍率两条命令（本次新移植，EL9 原生二进制侧也要有证据）=="
invoke '{"cmd":"get_default_cost_multiplier","args":{"appType":"claude"}}'; echo
invoke '{"cmd":"set_default_cost_multiplier","args":{"appType":"claude","value":"2.5"}}'; echo
invoke '{"cmd":"get_default_cost_multiplier","args":{"appType":"claude"}}'; echo
invoke '{"cmd":"set_default_cost_multiplier","args":{"appType":"claude","value":"-1"}}'; echo
echo "（期望：默认 \"1\" → 设 2.5 后读回 \"2.5\" → 负数被本地化错误拒绝）"

kill $PID 2>/dev/null; wait $PID 2>/dev/null
echo "== 服务日志尾部 =="; tail -6 /tmp/ccs-el9-native.log
