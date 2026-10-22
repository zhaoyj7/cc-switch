#!/usr/bin/env bash
# 在 WSL/Linux 上编译无头服务单二进制。
#
# 目标目录放在 ext4（默认 /root/ccs-target）：源码树在 /mnt/d，构建产物落在
# /mnt/d 上会慢一个数量级。
set -euo pipefail

# 非登录 shell 不会加载 rustup 的 PATH
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"

SRC="${SRC:-/mnt/d/projects/ccs/src-tauri}"
OUT="${OUT:-/root/ccs-target}"
PROFILE="${PROFILE:-release}"
BIN="${BIN:-cc-switch-server}"

cd "$SRC"
echo "== cargo build (--no-default-features --features headless) =="
FLAGS=()
if [ "$PROFILE" = "release" ]; then FLAGS+=(--release); fi
# root 的 /root/.gitconfig 里写了 http.proxy = 127.0.0.1:7890，WSL 里那个端口
# 通常不存在；只在本次调用里清空，不改用户的全局配置。
cargo build "${FLAGS[@]}" --no-default-features --features headless \
  --bin "$BIN" --target-dir "$OUT" --config 'http.proxy=""'

BIN_PATH="$OUT/$PROFILE/$BIN"
echo "== built: $BIN_PATH"
ls -lh "$BIN_PATH"
file "$BIN_PATH" 2>/dev/null || true
