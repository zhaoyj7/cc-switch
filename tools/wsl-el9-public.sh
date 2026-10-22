#!/usr/bin/env bash
set -uo pipefail
podman rm -f ccs-pub >/dev/null 2>&1 || true
podman run -d --name ccs-pub --cgroup-manager=cgroupfs --network=host \
  -e CC_SWITCH_TOKEN=el9-e2e-token \
  localhost/cc-switch-server:dev --bind 0.0.0.0 --port 14518 >/dev/null
echo "  容器已起：$(podman ps --filter name=ccs-pub --format '{{.Status}}')"
echo -n "  WSL 地址："; hostname -I | awk '{print $1}'
for i in $(seq 1 60); do [ -n "$(curl -s -m 1 http://127.0.0.1:14518/api/health)" ] && break; sleep 1; done
echo -n "  本机 health："; curl -s -m 5 http://127.0.0.1:14518/api/health; echo
echo -n "  无令牌 invoke 应 401："; curl -s -o /dev/null -w '%{http_code}\n' -m 5 -X POST http://127.0.0.1:14518/api/invoke -H 'Content-Type: application/json' -d '{"cmd":"is_lightweight_mode","args":{}}'
echo -n "  带令牌 invoke："; curl -s -m 5 -X POST http://127.0.0.1:14518/api/invoke -H 'Content-Type: application/json' -H 'Authorization: Bearer el9-e2e-token' -d '{"cmd":"is_lightweight_mode","args":{}}'; echo
