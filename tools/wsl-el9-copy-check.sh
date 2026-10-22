#!/usr/bin/env bash
# 守卫：EL9 原生二进制（release 构建，rust-embed 把 dist-legacy **编进二进制**）
# 实际服务出去的 JS bundle，必须与本地 `pnpm build:legacy:web` 的产物逐字节一致，
# 且包含本次新加的 4 种语言「v4 计费不使用倍率」文案。
# 用途：证明部署产物不是"命令加了但页面还是旧的"。
set -uo pipefail
BIN=${1:-/root/ccs-deploy/cc-switch-server-el9}
PORT=${2:-14522}
LOCAL=${3:-/mnt/d/projects/ccs/dist-legacy}
DATA=/tmp/ccs-el9-copy-check

invoke() { curl -s -m 8 -X POST "http://127.0.0.1:$PORT/api/invoke" \
  -H 'content-type: application/json' -d "$1"; }

rm -rf "$DATA"
mkdir -p "$DATA"
"$BIN" --bind 127.0.0.1 --port "$PORT" --data-dir "$DATA" > /tmp/ccs-el9-copy.log 2>&1 &
PID=$!
ready=no
for _ in $(seq 1 60); do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ready=yes; break; fi
  sleep 1
done
echo "ready=$ready"
[ "$ready" = yes ] || { tail -10 /tmp/ccs-el9-copy.log; exit 1; }

ASSET=$(curl -s -m 5 "http://127.0.0.1:$PORT/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "index 引用的 bundle = $ASSET"
curl -s -m 20 "http://127.0.0.1:$PORT/$ASSET" -o /tmp/ccs-served.js
SV=$(md5sum /tmp/ccs-served.js | cut -d' ' -f1)
LO=$(md5sum "$LOCAL/$ASSET" | cut -d' ' -f1)
echo "served md5 = $SV"
echo "local  md5 = $LO"
[ "$SV" = "$LO" ] && echo "PAGE-MATCH=yes" || echo "PAGE-MATCH=no"

echo "== 新文案命中（四种语言各一条，命中数应 >=1）=="
grep -o 'v4 计费不使用' /tmp/ccs-served.js | wc -l
grep -o '預設倍率（v4 計費不使用）' /tmp/ccs-served.js | wc -l
grep -o 'デフォルト倍率（v4 課金では未使用）' /tmp/ccs-served.js | wc -l
grep -o 'unused in v4 billing' /tmp/ccs-served.js | wc -l

echo "== 倍率命令在这个二进制上可用（注册表真的编进去了）=="
invoke '{"cmd":"get_default_cost_multiplier","args":{"appType":"claude"}}'; echo
invoke '{"cmd":"set_default_cost_multiplier","args":{"appType":"claude","value":"3.25"}}'; echo
invoke '{"cmd":"get_default_cost_multiplier","args":{"appType":"claude"}}'; echo

kill $PID 2>/dev/null; wait $PID 2>/dev/null
rm -rf "$DATA" /tmp/ccs-served.js
echo "== done =="
