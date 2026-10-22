#!/usr/bin/env bash
# 把镜像里的二进制抠出来，直接在 CentOS 9 宿主上试跑：
# 无头模式不碰 webview/gtk，但 ELF 的 DT_NEEDED 在 exec 时就要能解析——
# 这一步决定"在 Debian 编、在 CentOS 9 跑"这条链路成不成立。
set -uo pipefail
IMG=localhost/cc-switch-server:dev
BIN=/root/cc-switch-server-el9

podman rm -f ccs-out >/dev/null 2>&1 || true
echo "== 从镜像抠二进制 =="
CID=$(podman create "$IMG" true)
podman cp "$CID:/usr/local/bin/cc-switch-server" "$BIN"
podman rm ccs-out >/dev/null
chmod +x "$BIN"
ls -lh "$BIN"

echo "== 宿主缺哪些动态库 =="
ldd "$BIN" 2>&1 | grep -Ei "not found|webkit|gtk|glib|soup|javascript" | sed 's/^/  /'

echo "== 直接 exec（--help 只会打印用法，但加载器要先解析 NEEDED）=="
"$BIN" --help 2>&1 | head -20
echo "exec-status=$?"
