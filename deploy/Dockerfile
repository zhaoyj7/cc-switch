# 无头服务（only backend）镜像：一个容器里跑旧前端页面 + 命令 API + 事件流。
#
# 为什么要专门的构建环境：tauri 2 在 Linux 上把 gtk + webkit2gtk-4.1 写成无条件依赖
# （tauri-runtime 的 [target.'cfg(unix)'.dependencies]，与 wry 特性无关），而 gtk-rs 0.18
# 要求 glib >= 2.70。RHEL/CentOS Stream 9 只有 glib 2.68 且仅提供 webkit2gtk-4.0，
# 编译不过；Debian 12 / Ubuntu 22.10+ 同时具备 glib 2.7x 与 webkit2gtk-4.1。
#
#   docker build -f deploy/Dockerfile -t cc-switch-server .
#   docker run -d -p 127.0.0.1:14515:14515 \
#     -e CC_SWITCH_TOKEN="$(openssl rand -hex 24)" -v ccs-data:/data cc-switch-server
#
# 在 RHEL/CentOS Stream 9 上用 podman 跑（已实机验证）要注意两点：
#   1) root podman 的 -p 端口转发依赖 containernetworking-plugins，EL9 裸装没有，
#      要么 dnf 装上它，要么 --network=host 起（--network=host 时自己传 --bind/--port）。
#   2) 一定要挂命名卷（-v ccs-data:/data）。只靠镜像里的 VOLUME 会用匿名卷，
#      容器一重建 API Key 和供应商就没了。

FROM node:22.12.0-slim AS web
WORKDIR /app
# 用 npm 显式装 package.json 里 pin 的 pnpm 版本：corepack 的内置关键环已过期，
# 容器里会报 "Cannot find matching keyid" 而拿不到 pnpm。
RUN npm install -g pnpm@10.12.3
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build:legacy:web && rm -rf node_modules   # 产出 dist-legacy/

FROM rust:1-bookworm AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev && rm -rf /var/lib/apt/lists/*
COPY --from=web /app ./
RUN cargo build --release --no-default-features --features headless \
      --bin cc-switch-server --manifest-path src-tauri/Cargo.toml

FROM debian:bookworm-slim
# 二进制动态链接 gtk3/webkit2gtk（代码路径在无头模式里不会走到，但链接期就要这些库）
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libgtk-3-0 libwebkit2gtk-4.1-0 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/src-tauri/target/release/cc-switch-server /usr/local/bin/
ENV CC_SWITCH_DATA_DIR=/data
VOLUME /data
# 对外监听必须带令牌，程序会在没有 CC_SWITCH_TOKEN 时拒绝启动
EXPOSE 14515
ENTRYPOINT ["/usr/local/bin/cc-switch-server", "--bind", "0.0.0.0", "--port", "14515"]
