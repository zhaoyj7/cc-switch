# 交接文档：旧前端（v3.20.4）复活 + Web 版 + Linux 无头单二进制

> 写给下一位接手的 AI/工程师。读完这一份就能接着干，不需要翻历史对话。
> 所有"已验证"的结论都标了复现命令；标"未验证/推断"的不要当事实用。

**当前状态（2026-10-21 收尾；2026-10-22 追加 §11 只读评审 + §12 本地干净克隆实测与新工作流）**：
- 旧前端已在真浏览器里跑通：E2E **16/16**（`stream_check.rs:48` 改动后重编二进制、重启服务又跑了两遍，§3.5）。
- Rust 全量单测 **3763 通过 / 0 失败 / 11 ignored**（要带 `NO_PROXY=127.0.0.1,localhost`，之前那两个"失败"
  是本机 Windows 系统代理造成的假失败，根因与对照实验见 §3.5 备注）。
- 6 条 v3 命令移植完成，Windows + Linux（原生二进制 / 容器）**双侧都有 HTTP 实测**；成本倍率已按用户拍板
  处理完（**只补命令 + 加说明**，§6.1），不再有等功能决策。
- 部署产物两条路都已重编复验（见下方 ✅）。`src-legacy/` 仍与 tag `v3.20.4` 逐字节一致（§2 的核验命令）。
- 本机现场已清理（§6.3），只剩 `.e2e-home` 与在跑的 14515。
- **改动集已提交并推送**（`0912b6c1`，578 个文件），push 触发的 `ci.yml` **六个 job 全绿**（§12.5）。
  新增的 `build-artifacts.yml` 只注册未运行，等手动 dispatch。

**剩下**：① 一件功能活 —— 桌面版 `tauri.conf.json` 仍指向 v4 UI（§6.2）；② §11 里那 5 条行为决策 +
仓库卫生的 ⑩⑪，仍等你拍板（改动集本身已提交推送，§10 第 6 条）。
（`deploy/Dockerfile.old-glibc` 这个 zig 废案**已按用户指示删除**，连配套的 `tools/wsl-oldglibc-build.sh` 一起。）
> ✅ 部署产物**两条路都已在 2026-10-21 重编并复验**：EL9 原生单二进制（§5.6，sha256 `a6d2346d…`）
> 与容器镜像 `localhost/cc-switch-server:dev`（id `03e4b1ffea13`）。两者的页面资源与本地
> `pnpm build:legacy:web` 产物**逐字节一致**（`assets/index-0hufZJV7.js` md5 `36d6ce687c924c223f220fa06fcb8d38`），
> 倍率两条命令在 Linux 侧也已实测。发布前想再确认一遍就跑 `tools/wsl-el9-copy-check.sh`。

---

## 1. 任务目标（用户原始意图，未变）

1. 仓库 `D:\projects\ccs` 是 `https://github.com/zhaoyj7/cc-switch.git` 的克隆，当前代码是 **v4.0.15** 后端。
2. 把 **v3.20.4 的旧前端**从 git 历史里复活出来，做成能在**浏览器**里跑的版本。
3. 产出一个 **"onlybackend" 无头单二进制**，部署到**没有显示器的 Linux 服务器**：同一个可执行文件同时提供 API 和页面。
4. 旧 UI 需要的功能要**移植到最新 v4.0.15 后端**上。
5. 用 WSL2 + Rust 做真机验证。

## 2. 硬约束（用户明确说过，违反会被打回）

| 约束 | 说明 |
| --- | --- |
| `src-legacy/` 必须与 v3.20.4 **逐字节一致** | 所有适配只能发生在 vite 配置和 `web/transport/*` shim 里。禁止就地改 `src-legacy` 任何一行。**核验命令**（2026-10-20 实测：两边各 462 个文件，`diff -r` 退出码 0）：`TMPD=$(mktemp -d) && git archive v3.20.4 src \| tar -x -C "$TMPD" && diff -r "$TMPD/src" src-legacy`（Git Bash / WSL 都能跑；`v3.20.4` 是本仓库的 tag） |
| **不要**改用户的 WSL `/root/.gitconfig` | 里面有 `http.proxy = http://127.0.0.1:7890`，会让 cargo fetch 挂掉。绕过方式：每次调用加 `--config "http.proxy=\"\""` |
| 极简主义 | 不要顺手重构、不要加无关的抽象/mapper/wrapper、不要为假想的未来需求设计 |
| 每个结论要有证据 | 性能/正确性类的主张必须带实测证据；静默失败类的工作要附一个守卫测试 |
| 行为差异要报告、不要自己拍板 | 发现 v3/v4 行为或文案不一致，按 `文件:行号` 报给用户，由用户决定 |
| 绝不手改 lock 文件 | `package-lock.json` / `Cargo.lock` 只能由工具生成 |
| 注释默认不写 | 只在"为什么"不显然处写一行中文注释，不解释"做了什么" |
| 前端改动要真机验证 | 用真实无头 Chrome 走 CDP（`tools/browser-e2e.mjs`），不要只靠 typecheck/单测 |

## 3. 已完成且已验证的部分

### 3.1 旧前端复活（Windows 侧）
- `src-legacy/` = `git show v3.20.4` 抽出的完整旧前端源码。
- 构建配置：`vite.legacy.config.ts`（root=`src-legacy`，outDir=`dist-legacy`，`@/` 指向 `src-legacy/`）、`tsconfig.legacy.json`、`tailwind.legacy.config.cjs`、`postcss.legacy.config.cjs`。
- `package.json` 新增脚本：`dev:legacy`、`build:legacy`、`dev:legacy:web`、`build:legacy:web`、`typecheck:legacy`。
- `--mode web`（或 `CC_UI_TRANSPORT=web`）时，9 个 `@tauri-apps/*` 说明符被 alias 到 `web/transport/*.ts`：
  `api/core`、`api/event`、`api/window`、`api/app`、`api/path`、`plugin-dialog`、`plugin-log`、`plugin-process`、`plugin-updater`。

### 3.2 无头后端（v4 侧新增）
- `src-tauri/src/bin/server.rs`：CLI `--bind/--port/--token/--data-dir`，非 loopback 绑定强制要求 token。
- `src-tauri/src/headless/`：
  - `server.rs` — axum 路由：`POST /api/invoke`、`GET /api/events`(SSE)、`GET /api/health`、`GET /api/meta`、`/*path`(内嵌前端)。`require_token` 保护除 health 外的 `/api/*`。
  - `events.rs` — 事件桥，只转发旧前端真正监听的 **8** 个事件名。
  - `assets.rs` — `rust-embed` 内嵌 `../dist-legacy`，实现单二进制。
  - `bootstrap.rs` / `stubs.rs` — `tauri::test` MockRuntime 装配 + 无头空实现。
- `src-tauri/src/compat.rs` — `AppHandle` 等类型别名，桌面/无头共用一份上层代码。
- `src-tauri/src/setup.rs`、`lightweight_headless.rs`、`tray_headless.rs`、`tray_panel_headless.rs` — 无头替身。
- `src-tauri/src/command_handler.rs` — 命令注册表。
- `src-tauri/build.rs` 改动：**非 desktop 特性时**跳过 capability 扫描（否则 capabilities 引用的 opener/dialog 权限在无头下不存在，编译失败）。
- `src-tauri/Cargo.toml` 改动：Linux 的 `webkit2gtk` / `gtk` 改成 optional，只由 `desktop` 特性经 `dep:` 拉入。

### 3.3 Web transport shim（`web/`）
- `web/client.ts` — token 从 URL query 读取，存 localStorage key **`cc-switch-web-token`**；SSE 用 `EventSource('/api/events?token=...')`。
- `web/transport/core.ts` — `invoke` 走 HTTP；内含 `RESULT_ADAPT`，把 v4 的「结果+失败列表」结构解包成旧前端期望的裸数组（3 条 skill 命令，见 §6.1）。

### 3.4 移植的 6 条 v3 命令（`src-tauri/src/commands/`）
`get_stream_check_config`、`save_stream_check_config`、`stream_check_all_providers`、
`update_toml_common_config_snippet`、`get_default_cost_multiplier`、`set_default_cost_multiplier`。
- 逐条对照 `git show v3.20.4:...` 移植，行为保持一致（含 `category == "official"` 跳过、`proxy_targets_only` 过滤）。
- **一处有意的偏离**：`stream_check_all_providers` 里 v3 的 `db.get_current_provider()` 换成了
  `mode::current::provider_for(..., Purpose::InUse)`（`commands/stream_check.rs:48`）。
  原因不是风格：`mode/current.rs` 有一个源码扫描守卫测试
  `current_provider_is_read_through_provider_for`，禁止在 `mode::current` 之外直接读当前供应商；
  照抄 v3 会让 `cargo test --lib` 红。语义等价（接管中真正跑流量的那家）。
- **故意没移植**：v3 的 `save_stream_check_log` 和 `model_used` —— v4 的结构体/表里没有对应字段。
- `services/stream_check.rs` 的 `StreamCheckConfig` 重新加了 `#[derive(Serialize, Deserialize)] #[serde(rename_all="camelCase")]`，配置落到 settings 键值表（v4 已删掉 `stream_check_config` 表）。
- 倍率那两条只读写 `proxy_config.default_cost_multiplier` 列，**不进任何计费计算**（决策见 §6.1）。
- 完整清单与逐条实机验证记录在 **`tools/cmd-compat.md`**（尤其第五、六节）。

### 3.5 已跑通的验证（证据）
| 验证项 | 结果 | 复现 |
| --- | --- | --- |
| 浏览器 E2E | **16/16 通过**，无 console error | `node tools/browser-e2e.mjs`（真机 Chrome 走 CDP） |
| 6 条移植命令 | Windows + Linux 双侧 HTTP 实测通过 | `curl -X POST http://127.0.0.1:14515/api/invoke -d '{"cmd":"...","args":{...}}'`（字段名是 **`cmd`**，见 `headless/server.rs:45`） |
| SSE 事件桥 | 后端 `emit` → 浏览器收到帧 | `tools/browser-e2e.mjs` 里的 `create_profile`+`apply_profile` 断言 |
| token 门禁 | 非 loopback 无 token 被拒 | `tools/wsl-el9-public.sh` |
| 重启持久化 | 数据在容器重建/重启后保留 | `tools/wsl-el9-persistence.sh`（**必须用命名 volume**） |
| 容器产出的页面字节 | 与本地构建**逐字节一致** | `tools/wsl-el9-verify.sh` |
| **EL9 原生单二进制（无容器）** | **宿主直接跑通**：health/meta/页面 md5 一致/DB 读写往返/SIGTERM 干净退出 | `tools/wsl-el9-native-build.sh` + `tools/wsl-el9-native-smoke.sh`（详见 §5.6） |
| 交接前的最终复跑（2026-10-19） | 浏览器 E2E **10/10 再次通过**（23 次 invoke 全成功、SSE 两帧到达、无应用级报错） | `node tools/browser-e2e.mjs` |
| 倍率两条命令（HTTP） | 往返 + 校验错误都对：`"1"` → 设 `1.5` → `"1.5"`；`-2`/`abc`/`""` 各自报本地化错误 | `curl -X POST http://127.0.0.1:14515/api/invoke -d '{"cmd":"set_default_cost_multiplier","args":{"appType":"claude","value":"1.5"}}'` |
| 倍率不进计费 | 上游守卫测试仍然绿（把列改回可写之后依然绿） | `tools/rust.cmd test --lib --features test-hooks ignores_legacy_multiplier` |
| 面板文案（真浏览器） | 设置→使用统计→成本定价 的表头实际渲染成 **「默认倍率（v4 计费不使用）」**，同一行的输入框读到库里真实的 `1.75` | `node tools/browser-e2e.mjs`（第 12–14 项断言） |
| 供应商表单文案（真浏览器） | 编辑弹窗里 `#cost-multiplier` / `#pricing-model-source` 下方两行 Hint 已换成「v4 不再使用/只读全局」 | 同上（第 10–11 项断言） |
| Rust 全量单测（Windows MSVC） | **3763 通过 / 0 失败 / 11 ignored（41.63s，exit 0）** —— 命令：`set NO_PROXY=127.0.0.1,localhost` 后 `tools/rust.cmd test --lib --features test-hooks` | 之前那篇记录的「3761 通过 / 2 失败」两个失败**都是本机代理造成的假失败**，带上 `NO_PROXY` 后全绿；根因与三组对照见下方备注 |
| `stream_check.rs:48` 改动后的复跑（2026-10-20） | 三道门 `gate1=0 gate2=0 gate3=0`；`test --lib --features test-hooks stream_check` **13 通过 / 0 失败**（含守卫测试 `current_provider_is_read_through_provider_for`）；重编无头二进制并重启后浏览器 E2E **16/16 再次通过**（25 次 invoke 全成功） | `tools\rust.cmd test --lib --features test-hooks stream_check` + `node tools/browser-e2e.mjs` |
| `proxyTargetsOnly` 过滤语义未被改动破坏（HTTP） | 临时探测目标 `127.0.0.1:18099` + 两个测试供应商：`proxyTargetsOnly=true` 只返回正在跑流量的那家 `['e2e-probe-p']`，`false` 返回全部 `['e2e-idle-p','e2e-probe-p']`，无 panic、无 500 | 一次性 Node 探针，**现场已回收**（§6.3）；重跑办法：起一个监听 18099 的空 HTTP 服务 → `create_provider` 两家指向它 → `switch_provider` 到其中一家 → `stream_check_all_providers` 带/不带 `proxyTargetsOnly` 对比 `results` 里的 id |
| `src-legacy` 未被污染（硬约束） | 与 tag `v3.20.4` 的 `src/` **逐字节一致**：两边各 462 个文件，`diff -r` 退出码 **0** | 命令见 §2 表第一行（`git archive v3.20.4 src \| tar -x` + `diff -r`） |
| **EL9 原生产物重编（2026-10-21 00:06）** | `build-status=0`，cargo release 7m58s；产物 `/root/ccs-deploy/cc-switch-server-el9`（39048248 B，**sha256 `a6d2346dd9f5c6330f3e13dae173c2394da5eee32b53210b19a1660584d3a171`**）；verneed 最高 `GLIBC_2.34`、`hypot@GLIBC_2.2.5`，无 2.35+ | `tools/wsl-el9-native-build.sh`（**必须带 `--http-proxy=false`**，见 §9）+ `/root/ccs-el9-native.log` |
| 重编后的 EL9 二进制仍原生可跑 + 新命令可用 | 裸跑冒烟全绿：health/meta、`index.html` md5 与本地一致、`stream_check` 配置往返、**倍率 `"1"`→设 `2.5`→读回 `"2.5"`、`-1` 被拒**（`无效倍率: -1 - 倍率不能为负数`）、SIGTERM 干净退出 | `tools/wsl-el9-native-smoke.sh /root/ccs-deploy/cc-switch-server-el9`（脚本已加倍率那一段） |
| EL9 二进制里**嵌的是新 UI**（不是"命令加了页面还是旧的"） | 服务出去的 `assets/index-0hufZJV7.js` md5 `36d6ce687c924c223f220fa06fcb8d38`，与本地 `dist-legacy` **完全一致**；四种语言的「v4 不使用倍率」文案各命中 1 次；同一二进制上倍率 `"1"`→`3.25` | `tools/wsl-el9-copy-check.sh`（新增的守卫脚本，可当发布前检查用） |
| **容器镜像重编（2026-10-21）** | `build-status=0`，`localhost/cc-switch-server:dev` → id `03e4b1ffea13`；用新镜像重建 `ccs-e2e` 后：页面资源 md5 同样 `36d6ce68…`（**PAGE-MATCH=yes**）、4 语言文案各命中 1 次、倍率 `"1"`→`2.5`→`-1` 报本地化错误、SSE 两帧到达、`stream_check` 打出 `operational/77ms` | `tools/wsl-podman-build.sh` + `tools/wsl-el9-container-test.sh`（两个脚本都已加 `--http-proxy=false` / 新增断言） |
| 新镜像的重启持久化与令牌门 | 容器重启后配置与供应商都还在（`4/1/2500`、`el9-local`）；对外监听时 `authRequired=true`、无令牌 invoke **401**、带令牌正常 | `tools/wsl-el9-persistence.sh`、`tools/wsl-el9-public.sh`（2026-10-21 在新镜像上复跑） |

> 那两个"失败"的定位过程（2026-10-20 提出 → **2026-10-21 根因确认，带 `NO_PROXY` 后全量 3763/0 绿**）：
> - `proxy::error::tests::describe_reqwest_error_keeps_cause_and_drops_url`（`src/proxy/error.rs:270`）：
>   测试「绑一个随机端口→释放→期望连接被拒」，实际收到 **502（`connection: close`、`content-length: 0`）**。
>   **根因 = 本机的 Windows 系统代理**（HKCU `ProxyEnable=1`、`ProxyServer=127.0.0.1:7890`）。
>   reqwest 0.12 的 `Client::new()` 除了读 `*_proxy` 环境变量，还会读 Windows 注册表里的系统代理，
>   所以那个"已经释放的端口"的请求其实被交给 127.0.0.1:7890，代理对不可达上游回了 502。三组对照实测：
>   ① 裸跑（Git Bash/cmd 里**没有**任何 `*_PROXY`）→ FAIL，报 `status: 502`；
>   ② `NO_PROXY=127.0.0.1,localhost` 再跑 → **PASS**；
>   ③ `HTTP_PROXY=http://127.0.0.1:7890` 再跑 → FAIL（与 ① 同一条 502）。
>   旁证：`curl -x http://127.0.0.1:7890 http://127.0.0.1:11813/v1/responses` → **502**，
>   而 `curl --noproxy '*'` 同一个地址 → 连接被拒。`src/proxy/error.rs` 与 `Cargo.toml` 的 reqwest 行都没动过。
>   **以后跑这套测试就带上**：`NO_PROXY=127.0.0.1,localhost tools\rust.cmd test --lib --features test-hooks`。
>   （Linux/容器侧没这个问题：容器里没注册表，WSL 那个 127.0.0.1:7890 也够不着，见 §9 的 `--http-proxy=false`。）
> - `proxy::server::tests::responses_websocket_handshake_is_answered_with_upgrade_required`：
>   全量并发跑时报 `10053 连接被主机中的软件中止`，**单独跑（`-- --exact --test-threads=1`）通过** → 并发 flake。
>   2026-10-21 那次带 `NO_PROXY` 的**默认并发全量跑里它是通过的**，所以它是偶发（负载/端口时机），
>   与代理那条无关；真复现时先用 `--test-threads=1` 隔离，别改测试逻辑。

### 3.6 旧前端的文案覆盖层（`web/i18n/`，新增机制）
`src-legacy` 不许改一个字，但有些文案必须讲清楚（§6.1）。做法是**构建期别名**：
`vite.legacy.config.ts` 里的 `I18N_OVERRIDES` 把 `src-legacy/i18n/index.ts` 的
`"./locales/xx.json"` 相对说明符换成 `web/i18n/xx.ts`，后者 `import` 原始 JSON 再用
`withCopyOverrides(messages, {"a.b.c": "新文案"})` 深拷贝覆盖指定路径。
- vite 的 `resolve.alias` 对**相对**说明符同样生效（`find` 用 `^\.\/locales\/zh\.json$` 这种锚定正则）。
- 别名是**无条件**加的（桌面/ web 两种模式都覆盖）：旧 UI 在本仓库里永远配 v4 后端，说明与传输方式无关。
- 只有 4 个 locale 文件走这条路（`en/ja/zh/zh-TW`），全仓库只有 `i18n/index.ts` 引它们，别名字面量不会
  误伤别的 import。
- 加新覆盖项 = 往 `web/i18n/<locale>.ts` 的对象里加一行，键名用组件里 `t(...)` 的**实际渲染键**
  （面板表头是 `settings.globalProxy.defaultCostMultiplierLabel`，`…Hint` 那个键组件里没用到）。

## 4. 部署产物（`deploy/`）
- `Dockerfile` — 3 阶段：`node:22.12.0-slim`（`npm install -g pnpm@10.12.3` → `pnpm install --frozen-lockfile` → `pnpm build:legacy:web`）→ `rust:1-bookworm`（装 `pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev`，`cargo build --release --no-default-features --features headless --bin cc-switch-server`）→ `debian:bookworm-slim` 运行层。
- `Dockerfile.el9-native` — 产出**可在 CentOS Stream 9 原生直接跑**的单二进制（§5.6 已闭环）。
- `cc-switch-server.service` — systemd 单元（`DynamicUser`、`StateDirectory=cc-switch`、`ProtectSystem=strict`、`EnvironmentFile=-/etc/cc-switch/server.env`）。
- `.dockerignore` — 排除 `node_modules/.git/dist/dist-legacy/src-tauri/target/.e2e-*`，**保留** `src-tauri/gen` 和 `src-tauri/icons`（tauri-build 需要）。

## 5. Linux / CentOS Stream 9 调查结论（本次会话的主要未决点）

用户环境：**WSL2 里的 CentOS Stream 9**，已装 podman（用户同意装的）。
用户问"我这个 centos9 不行吗"，答案是**分两半**：

### 5.1 不能在 EL9 上原生编译（已实测）
- 根因：`tauri` 和 `tauri-runtime` 在 Linux 上把 `gtk` + `webkit2gtk` 声明为**非可选**依赖；`muda` 也带 `gtk3`。
- `glib-sys 0.18` 要求 `glib-2.0 >= 2.70`，EL9 只有 **2.68.4**。
- EL9 任何仓库都**没有** `webkit2gtk-4.1`（用 `repoquery --whatprovides 'pkg-config(webkit2gtk-4.1)'` 确认过）。
- 我对 `Cargo.toml` 做的 optional 化是**正确但不够**：headless 的 Linux resolve 里仍然有 gtk/webkit2gtk/glib（经 `tauri-runtime` 进来）。

### 5.2 容器构建（已验证可用；后来 §5.6 的原生路线也通了，两条并列可选）
在 EL9 上用 podman 跑 `deploy/Dockerfile` 编出二进制。两个 EL9 特有的坑：
- `-p` 端口映射不可用 —— 缺 `containernetworking-plugins`。**用 `--network=host`**。
- 匿名 `VOLUME /data` 在容器重建后数据丢失。**必须用命名 volume**。
- 首次启动的 DB 迁移很慢，就绪探测别用 `curl -s -m 1` 快速重试，要 `sleep 1` 轮询。

### 5.3 产物拷回 EL9 宿主直接跑：只差一个符号（**已复测，证据如下**）
复现：`MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-gap.sh /root/ccs-deploy/cc-switch-server`
（`/root/ccs-deploy/cc-switch-server` 是用 `podman cp ccs-e2e:/usr/local/bin/cc-switch-server` 拷出来的，39 MB，stripped）
- 宿主：`CentOS Stream 9`，`glibc-2.34-273.el9`、`glib2-2.68.4-20.el9`、`gtk3-3.24.31-12.el9`。
- DT_NEEDED 共 13 项：`liblzma libssl libcrypto libgobject-2.0 libgtk-3 libgdk-3 libgdk_pixbuf-2.0
  libgio-2.0 libglib-2.0 libgcc_s libm libc ld-linux`。**没有 webkit/libsoup**（`--as-needed` 掉了），
  所以运行期不需要装 webkit —— 但**需要 gtk3**，EL9 自带。
- `.gnu.version_r`：`libc.so.6` 最高只要 **GLIBC_2.34**（EL9 满足）；`libm.so.6` 多要一条 **GLIBC_2.35**。
- 全二进制里需要 GLIBC_2.35+ 的符号**只有 1 个**：
  `367: ... FUNC GLOBAL DEFAULT UND hypot@GLIBC_2.35`（来自 Rust std `f64::hypot` 调 libm）。
- 符号级比对（`tools/wsl-el9-symcheck.sh`）：129 个 UND 里，EL9 找不到的除 `hypot` 外全是 **WEAK**
  （`pidfd_spawnp`/`pidfd_getpid`/`posix_spawn_file_actions_addchdir`/`ZSTD_trace_*`/`__gmon_start__`/`_ITM_*`），
  ld.so 对 WEAK 缺失是容忍的 → **`hypot` 是唯一硬阻塞**。
- 真实 exec 报错：`/lib64/libm.so.6: version 'GLIBC_2.35' not found (required by ...)`，退出码 1。

### 5.3.1 已试过的取巧办法：LD_PRELOAD **不行**（别再试）
`tools/hypot-shim.c` + `tools/hypot-shim.map` 编出的预加载库确实导出了 `hypot@@GLIBC_2.35`，
但 exec 仍报同样的错。原因：`_dl_check_map_versions` 在装载阶段校验
「`libm.so.6` 这个对象是否提供版本串 GLIBC_2.35」，这是**按 DT_NEEDED 目标对象**查的，
不看别的对象能不能供符号。**任何 preload / 注入类方案都绕不过 verneed 记录。**
结论：只能在**链接期**让这个引用根本不产生。

### 5.4 尝试过并失败的老 glibc 路线
- **zig / cargo-zigbuild**（`Dockerfile.old-glibc`，`--target x86_64-unknown-linux-gnu.2.34`）：
  `zig: error: version '.2.34' in target triple ... is invalid`，来自 `ring 0.17.14` 和 `aws-lc-sys 0.36.0` 的 build script；另有 `__time64_t` unknown type。
  （附带踩坑：zig 0.13.0 的下载资产名是旧的 `zig-linux-x86_64-*`，要用 **0.14.1**；openssl-sys 找不到头文件要 `ENV CFLAGS="-I/usr/include/x86_64-linux-gnu"`。）
- **Fedora 35 当构建工具链**（本次会话最后一步，**已实测**）：
  - EOL 但**仓库还活着**，`dnf` 能解析并安装成功。
  - `glibc 2.34`（正好等于 EL9）、`gtk3 3.24.34`、`glib 2.70.5`（满足 gtk-rs 下限）。
  - **但 `webkit2gtk-4.1` 没有任何 provider**，只有 `webkitgtk4-devel`（= 4.0）。
  - 实测确认：`--no-default-features --features headless` 的构建日志里确实有
    `Compiling webkit2gtk v2.0.2`（见 EL9 上的 `/root/ccs-el9-native.log`），
    它的 build script 要 `pkg-config webkit2gtk-4.1` → **Fedora 35 这条路确定不通**，不用再试。

### 5.5 让 EL9 原生可跑的候选
1. **就用容器**（零 hack，**已验证可用**）：EL9 上 `podman run --network=host -v ccs-data:/data`，或直接发 Debian 运行镜像。
2. **链接期自己定义 `hypot`**（在本 crate 加 build.rs + C）：可行但要往代码库里塞不显眼的 hack，精度还得自己实现。
3. **在 Debian 容器里链接 EL9 的 glibc** —— **探针已验证通过，且不改任何业务代码**：
   `tools/wsl-el9lib-link-probe.sh` 把 EL9 宿主的 `/lib64` 只读挂进 Debian 构建容器，
   复制成 `/link/libm.so`、`/link/libc.so`，再用 `rustc -C link-arg=-L/link` 编一个调用
   `f64::hypot` 的小程序。结果（实测输出）：
   - `.gnu.version_r` 里 `libm.so.6` 的需求从 GLIBC_2.35 变成 **GLIBC_2.34/2.2.5**，`grep -c GLIBC_2.35` = **0**；
   - 引用变成 `UND hypot@GLIBC_2.2.5`；
   - 产物在 **CentOS Stream 9 宿主上 `EXIT=0` 正常执行**（`hypot=5.0e300`），`ldd` 无 not found。
   → 已按此写出正式构建文件 **`deploy/Dockerfile.el9-native`**：用
   `FROM quay.io/centos/centos:stream9 AS el9lib` + `COPY --from=el9lib /usr/lib64/lib{c,m}.so.6`
   取 EL9 的 glibc（不依赖会变的 rpm 下载 URL），`ENV RUSTFLAGS="-C link-arg=-L/el9lib"`，
   并内置一条**守卫**：构建末尾 `! readelf -V … | grep -q 'GLIBC_2\.3[5-9]'`，
   谁以后又把 GLIBC_2.35+ 引回来就直接构建失败。
   驱动脚本：`tools/wsl-el9-native-build.sh`（build → `podman cp` 出二进制 → 打 verneed 与 hypot 引用）。
   复现探针：`tools/wsl-el9-link-order-probe.sh`（在 Debian 容器里用最小 cargo 项目对比三种链接方式）：

   | 链接方式 | verneed 最高 | hypot 引用 |
   | --- | --- | --- |
   | A. 默认（基线） | **GLIBC_2.35** | `hypot@GLIBC_2.35` |
   | B. `RUSTFLAGS="-C link-arg=-L<EL9 glibc>"` | GLIBC_2.34 | `hypot@GLIBC_2.2.5` ✅ |
   | C. 覆盖 Debian 的 `libm.so` 链接脚本为 `GROUP ( <EL9 libm> )` | GLIBC_2.34 | `hypot@GLIBC_2.2.5` ✅ |

   → `-L` 这条路在 **cargo 链接路径下确实生效**（不是只在裸 rustc 下生效），方案 3 成立。

   **重要修正（实测）**：真实全量产物用 **B（`RUSTFLAGS=-C link-arg=-L/el9lib`）没有生效** ——
   守卫照样抓到 `367: ... UND hypot@GLIBC_2.35`。原因：真实构建里 gtk-sys / webkit2gtk-sys 等
   build script 会先 emit `-L /usr/lib/x86_64-linux-gnu`，Debian 的 `libm.so` 链接器脚本先被命中。
   最小探针（无其它 `-L`）之所以通过，是因为只有我们那一条 `-L`。**已改用 C 组做法**：
   直接把 `/usr/lib/x86_64-linux-gnu/libm.so` 覆盖成 `GROUP ( /el9lib/libm.so.6 )`，与搜索顺序无关。
   只覆盖 libm 即可：产物对 `libc.so.6` 的版本需求最高就是 GLIBC_2.34（EL9 满足），越界的只有 hypot。
   守卫已拆成独立一步，失败时会打印 offending 符号 + 完整 verneed，重跑 `tools/wsl-el9-native-build.sh` 即可自诊断。
   ⚠️ 上面 C 组在真实产物上的闭环**已完成并通过**（2026-10-19 23:00 前后实测，见 §5.6）：
   守卫是构建的最后一步，**所以 `podman build` 成功 = GLIBC_2.35+ 需求确实被消掉了**。

### 5.6 EL9 原生单二进制：已闭环可用（2026-10-19 实测）

拿 §5.5 方案 3（覆盖 `libm.so` 链接脚本）编出的产物，**不套容器**直接跑在 CentOS Stream 9 宿主上：

```
$ /root/ccs-deploy/cc-switch-server-el9 --bind 127.0.0.1 --port 14521 --data-dir /tmp/ccs-el9-native-data
ready=yes  alive=yes
health : {"app":"cc-switch","version":"4.0.15","authRequired":false}
meta   : {"version":"4.0.15","homeDir":"/root","os":"linux","arch":"x86_64","authRequired":false}
index  : 665 B，md5 a328e2015378cf75144f94e367c093e7 == 本地 dist-legacy/index.html
invoke : get_stream_check_config -> {"timeoutSecs":8,"maxRetries":1,"degradedThresholdMs":6000}
         save_stream_check_config(11/2/3333) -> null
         get_stream_check_config -> {"timeoutSecs":11,"maxRetries":2,"degradedThresholdMs":3333}
退出   : 收到 SIGTERM 正常清理（"退出清理完成：客户端已指回直连，代理已停止"）
```
- 二进制 39,020,504 B；verneed 里 `libm.so.6` 只剩 `GLIBC_2.2.5` + `GLIBC_2.29`，
  `hypot@GLIBC_2.2.5`；`libc.so.6` 最高 `GLIBC_2.34`。**全二进制再无 GLIBC_2.35+ 需求。**
- glib 运行时 2.68（编译期 2.74）**没有造成 symbol lookup error** —— §5.3 的符号级比对预言成立。
- 复现：`tools/wsl-el9-native-build.sh`（构建+抽出+verneed） → `tools/wsl-el9-native-smoke.sh`（裸跑功能冒烟）。
  注意 `/api/invoke` 的字段是 **`cmd`** 不是 `command`（`headless/server.rs:45`）；首次启动要跑 DB 迁移，
  就绪探测要 `sleep 1` 轮询，别用 `curl -m 1` 快速重试。

**2026-10-21 重编复验**（加了 2 条倍率命令 + 4 语言新文案之后）：
- 产物换成 39,048,248 B、sha256 `a6d2346dd9f5c6330f3e13dae173c2394da5eee32b53210b19a1660584d3a171`；
  verneed 结论不变（`libc` 最高 `GLIBC_2.34`、`hypot@GLIBC_2.2.5`，无 2.35+），Dockerfile 里那道
  readelf 守卫仍然绿。
- 裸跑冒烟**多了倍率那一段**且通过：`"1"` → 设 `2.5` → 读回 `"2.5"` → `-1` 报「无效倍率…倍率不能为负数」。
- 判断"部署的到底是不是新包"要看页面资源：`index.html` md5 从 `a328e201…` 变成 `38295f78…`，
  而 `assets/index-0hufZJV7.js` 的 md5 `36d6ce687c924c223f220fa06fcb8d38` 与本地 `dist-legacy` **逐字节一致**。
  这条检查已固化成 `tools/wsl-el9-copy-check.sh`（发布前跑一次即可）。
- 构建命令现在**必须带 `--http-proxy=false`**（已写进脚本），否则 `pnpm install` 会被 WSL 宿主那个
  `127.0.0.1:7890` 代理拖死，见 §9。

**所以 CentOS 9 的答案现在是四条**：
1. 想要**一个文件、不要容器** → `deploy/Dockerfile.el9-native` 产物，已在 EL9 宿主原生验证可跑（§5.6）。
2. 想要**镜像部署** → `deploy/Dockerfile` + podman（早先已验证，注意 `--network=host` 与命名卷）。
3. **放弃 EL9 原生**，明确要求宿主 glibc ≥ 2.35（Debian 12 / Ubuntu 22.04）。
4. ~~加 glibc shim 到宿主~~ / **LD_PRELOAD**：**已证明无效**，见 §5.3.1。

> 补充：EL9 宿主自带 gtk3，产物运行期**不需要** webkit（§5.3）。glib 运行时 2.68 vs 编译期 2.74 也
> **不构成阻塞** —— §5.3 的符号级比对已经证明：除 hypot 外，EL9 的 glib/gtk so 提供了本二进制需要的
> 全部强符号；§5.6 的宿主裸跑冒烟（health/meta/页面 md5/DB 往返/SIGTERM）已把这条预言坐实。

## 6. 待决策 / 待收尾

### 6.1 【已决策并实施】默认成本倍率：只补命令 + 加说明（`tools/cmd-compat.md` 第五节有背景）

2026-10-20 用户选定**走法 1**：把 `get/set_default_cost_multiplier` 两条命令补回来（面板不再报错），
并在 UI 上写明 v4 计费不使用这个值；**不动**上游的计费链路。已实施，证据见 §3.5。

**为什么这样切是对的（v3.20.4 语义已逐行核实，比想象的窄）**：
- v3 里生效的只有一条路：**代理接管**计费。`proxy/response_processor.rs:642` 调
  `logger.resolve_pricing_config(provider_id, app_type)`，实现在 `proxy/usage/logger.rs:350-379`：
  读 `proxy_config.default_cost_multiplier`（按 app 一行；`claude-desktop` 继承 `claude`），
  供应商级 `providers.cost_multiplier` 可覆盖，解析失败回落 1 并打 `[USG-003]` warn。
- 作用点只有一个：`proxy/usage/calculator.rs:104` `let total_cost = base_total * cost_multiplier;`
- **会话导入那条路 v3 就写死了 1**：`services/session_usage.rs:843`，另外 `session_usage_mcode.rs:60`、
  `calculator.rs:217` 也直接传 `Decimal::ONE`。所以「还原 v3 语义」≠「还原全链路」。
- v4 是**有意**停用：`proxy/usage/logger.rs:405` 传 `Decimal::ONE`，并有守卫测试
  `proxy/response_processor.rs:1232 test_log_usage_ignores_legacy_multiplier_and_provider_overrides`。
- **上游自己就把这类字段定性为「原样往返、不参与计算」**：`src-tauri/src/provider.rs:507-511` 给
  `costMultiplier` / 供应商级 `pricingModelSource` 的注释是「已停用……只为与旧版设备同步时原样往返保留」。
  本次做法与上游口径一致。

**实际落地的东西**：
- 后端：DAO `get/set_default_cost_multiplier`（`database/dao/proxy.rs:124,145`，含
  `validate_cost_multiplier`：空/非数字/负数各自报本地化 `AppError`）、命令 + `*_internal` +
  `*_test_hook`（`commands/proxy.rs:341-400`）、注册进 `command_handler.rs:240-241`，
  单测 `test_default_cost_multiplier_round_trip` / `..._validation`。
- 前端：`web/i18n/` 覆盖三处文案（机制见 §3.6）——面板表头 + 供应商表单的两行 Hint。
  供应商表单那两个字段（`costMultiplier`、供应商级 `pricingModelSource`）本来就能往返、不报错，
  但原文案「实际成本 = 基础成本 × 倍率」「选择按请求模型还是返回模型进行定价匹配」是**错的**，一并改掉。
- **没做**（用户没选走法 2，别自作主张接回去）：把倍率重新乘进 `logger.rs` / `calculator.rs`。

### 6.2 桌面版仍指向 v4 UI（**等你拍板**，不是技术阻塞）
`src-tauri/tauri.conf.json` 的 `frontendDist: ../dist`、`devUrl: http://localhost:3000` 还是 v4 前端。

**先把一条过时结论纠正掉**：早先这里写着"要让桌面版跑旧 UI，需要一个不被 alias 吞掉的真实 tauri 导入路径"——
**不成立**。`vite.legacy.config.ts:38` 的 shim 别名是**按 mode 开关**的
（`webTransport = mode === "web" || CC_UI_TRANSPORT === "web"`），默认模式不装别名，`@tauri-apps/*` 走真包。
实测证据（2026-10-21）：`pnpm exec vite build --config vite.legacy.config.ts --outDir ../dist-legacy-desktop`
**exit 0，13.04s**，产物 `assets/index-xVfo7ZYQ.js` 4,626.87 kB，里面有 4 处 `__TAURI_INTERNALS__`
（说明真的链进了官方 JS 包，不是 shim）；`web/i18n` 的新文案也在（`v4 计费不使用` / `unused in v4 billing` 各 1 处，
证明 §3.6 的别名是两种模式都生效）。顺带：产物里有个 `__vite-browser-external-*.js` 空壳 chunk，
`export {}`、没人引，是无害的死重量。

所以剩下的只有三件事，而且第一件是**决策不是体力**：
1. **要不要让桌面版换成旧 UI**：这等于改变桌面交付形态（v4 UI 就没入口了）。建议不要直接覆盖
   `tauri.conf.json`，而是加一条 `tauri.legacy.conf.json` + 一个 npm script，两套 UI 都能出包 —— **等你点头再做**。
2. 改哪几行（`src-tauri/tauri.conf.json:7-9`，实测现值）：`build.frontendDist` `../dist` → `../dist-legacy`、
   `build.devUrl` `http://localhost:3000` → `http://localhost:3001`（`vite.legacy.config.ts:59` 就是 3001，
   v4 的 `vite.config.ts:28` 是 3000，两边都 `strictPort`，**两套 dev server 能并存**）、
   `beforeDevCommand` `pnpm run dev:renderer` → `pnpm run dev:legacy`。生产侧还要让
   `build:legacy`（桌面模式，产物在 `dist-legacy`）先于 `tauri build` 跑。
3. 真机验证：v3 UI 调的命令名与 v4 后端是否都对得上，只有在 webview 里点一遍才知道。
   可行做法：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<现挑空闲端口>` 起 `pnpm tauri dev`，
   再把 `tools/browser-e2e.mjs` 的 CDP 断言指过去（**注意 §9 那条固定端口的坑，别再用 9333**）。
   已知风险点：§3.4 的 6 条命令是**为旧 UI 补的**，其余命令名两边一致性只做过静态比对（`tools/cmd-diff.json`），
   没有运行时覆盖。

### 6.3 现场清理（2026-10-20 收尾后已更新）
- 还在跑的后台进程：只剩 Windows `cc-switch-server`（端口 **14515**，2026-10-20 用 `.e2e-home` 数据目录重启过，
  debug 构建的 rust-embed **按请求读盘**，改完 `dist-legacy` 不用重编二进制）、
  EL9 容器 `ccs-e2e`（**14517**，无 token）和 `ccs-pub`（**14518**，token `el9-e2e-token`）。
  启动方式（日志落在 `tools/e2e-server.log` / `tools/e2e-server.err.log`）：
  `Start-Process D:\projects\ccs\src-tauri\target\debug\cc-switch-server.exe -ArgumentList '--bind','127.0.0.1','--port','14515','--data-dir','D:\projects\ccs\.e2e-home'`
- **已清掉**：Node 探测目标（`127.0.0.1:18099`，PID 40268，`taskkill /PID 40268 /F`）；
  `proxyTargetsOnly` 冒烟用的两个测试供应商 `e2e-probe-p` / `e2e-idle-p`（`delete_provider`，
  删前用 `switch_provider` 把 claude 指回 `claude-official`）；累积的 7 条 `e2e-sse` profile（`delete_profile`，
  现在 `list_profiles` 为 0）。四个应用的倍率都是 `"1"`。
- `tools/browser-e2e.mjs` 已改成**用完即删**自己创建的 profile（事件帧断言后补一次 `delete_profile`），
  所以重复跑不再攒垃圾；改完复跑仍 **16/16**。
- **别人留下的 headless Chrome 在监听 9333**（`D:/projects/newapi/tmp-e2e/chrome-profile2`，PID 25520）。
  那是另一个项目的进程，**不要杀**；`tools/browser-e2e.mjs` 已改成自己挑空闲端口（§9）。
- 临时文件（2026-10-20 收尾）**已清**：仓库根下本会话/前几会话的 `.log` 与一次性探针产物
  （`.e2e-gate3.json`、`.e2e-gate4.json`、`.e2e-probe-target.mjs`、`.e2e-sse-frame.txt`、`.probe.json`、
  `.rt-*.log`、`.rusttest*.log` 等约 40 个）已全部删除，`%TEMP%\ccs-e2e-profile-*` / `ccs-probe-*` 也删了。
  **仍在**的只有：`.e2e-home/`（14515 那个服务正在用的数据目录，删了服务就没数据）、
  `tools/e2e-server.log` / `tools/e2e-server.err.log`（那个服务的活动日志）、
  `tools/wsl-el9-link-order-probe.sh` 等 `tools/wsl-*probe.sh`（§8 的复现脚本，**不是**垃圾）。
- `tools/lib.rs.bak` **先别删**：2101 行，跟 `git show HEAD:src-tauri/src/lib.rs` **不一致**，
  而现在的 `src-tauri/src/lib.rs` 只有 1146 行（拆模块后的版本）。它很可能是拆分前的快照，
  真要清理请先逐段确认内容已经都在 `setup.rs` / `compat.rs` / `lightweight_headless.rs` 里。
- WSL 侧现在的状态（2026-10-21 重编后）：
  **别删**的是产物 —— `/root/ccs-deploy/cc-switch-server-el9`（sha256 `a6d2346d…`，就是要交付的那个文件）、
  镜像 `localhost/cc-switch-server:el9`（`d8cdebfa6aef`）与 `:dev`（`03e4b1ffea13`）。
  在跑的容器：`ccs-e2e`（14517，无 token）、`ccs-pub`（14518，token `el9-e2e-token`），都已是新镜像。
  可删的日志/临时目录：`/root/ccs-el9-native.log`、`/root/ccs-podman-build.log`、`/tmp/pb.out`、
  `/tmp/ccs-el9-native-data`、`/tmp/el9-sse.txt`、`/root/hypot-out/`、`/root/probe.sh`、`/root/lp.sh`、
  `/tmp/libhypot-shim.so`。之前那个 `podman create` 没起起来的 `great_jackson` 已删。
  `container-test` 脚本为 stream_check 起的 `python3 -m http.server 18099` 现在会在脚本结尾 `pkill` 掉。
- `tools/hypot-shim.c` / `tools/hypot-shim.map` 是 **LD_PRELOAD 反例**的存档（§5.3.1 证据），
  不是要接进构建的代码，别误用。
- 整个改动**尚未提交**（`git status` 有大量 M 和 ??，见 §7）。

## 7. 改动清单速查

**新增（未跟踪）**：`.dockerignore`、`deploy/`、`dist-legacy/`（**2026-10-22 起改为 ignore，不入库**，见 §12.4）、`postcss.legacy.config.cjs`、`tailwind.legacy.config.cjs`、`tsconfig.legacy.json`、`vite.legacy.config.ts`、`src-legacy/`、`web/`、`tools/`、`.github/workflows/build-artifacts.yml`、
`src-tauri/src/bin/`、`src-tauri/src/command_handler.rs`、`src-tauri/src/compat.rs`、`src-tauri/src/headless/`、`src-tauri/src/lightweight_headless.rs`、`src-tauri/src/setup.rs`、`src-tauri/src/tray_headless.rs`、`src-tauri/src/tray_panel_headless.rs`

**修改**：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/build.rs`、`src-tauri/src/lib.rs`，以及 `src-tauri/src/commands/*`、`services/*`、`proxy/*`、`database/dao/settings.rs` 等一批（完整列表 `git status --porcelain`）。

**2026-10-20 增量（成本倍率走法 1）**：
- 后端：`database/dao/proxy.rs`（DAO + 校验 + 2 个单测）、`commands/proxy.rs`（2 条命令 + internal + test_hook）、
  `command_handler.rs:240-241`（注册）、`commands/stream_check.rs:48`（改用 `mode::current::provider_for`，见 §3.4）。
- 前端：新增 `web/i18n/{copy-overrides,zh,zh-TW,en,ja}.ts`，`vite.legacy.config.ts` 加 `I18N_OVERRIDES` 别名（§3.6）。
- 验证：`tools/browser-e2e.mjs` 新增 6 项断言（供应商表单 2 行 Hint、倍率命令往返、面板表头、面板读到的值、复位），
  并把 CDP 端口从固定 9333 改成运行时挑空闲端口；`tools/rust.cmd` 的注释改成 ASCII（§9）。

**2026-10-21 增量（重编产物 + 定位假失败，无业务代码改动）**：
- 构建脚本：`tools/wsl-el9-native-build.sh`、`tools/wsl-podman-build.sh` 加 `--http-proxy=false`
  （后者补 `exit $st`，原来失败也返回 0）；`tools/wsl-el9-native-smoke.sh` 加倍率命令一段；
  `tools/wsl-el9-container-test.sh` 加「页面 md5 与本地一致 + 4 语言文案 + 倍率往返」一段并在结尾 pkill 探针服务。
- 新增脚本：`tools/wsl-el9-copy-check.sh`（发布前守卫：产物内嵌 UI 是否就是最新构建）、
  `tools/wsl-npm-egress-probe.sh`（容器三种网络模式下的外连对照，用来区分"断网"和"代理注进容器"）、
  `tools/wsl-github-egress-probe.sh`（github 直连性对照，见 §9 那条前提）。
- 新增结论（§6.2）：旧 UI 的**桌面模式构建本身是通的**
  （`pnpm exec vite build --config vite.legacy.config.ts --outDir ../dist-legacy-desktop` exit 0 / 13s，
  产物里 4 处 `__TAURI_INTERNALS__`，新文案也在），桌面版没接过去只是 `tauri.conf.json` 还指着 v4。
  临时产物 `dist-legacy-desktop/` 已删，`dist-legacy/`（web 版）未被覆盖，md5 仍是 `36d6ce68…`。
- 删除：`tools/wsl-oldglibc-build.sh`（zig 废案的配套脚本，`deploy/Dockerfile.old-glibc` 已删）。
- 测试结论：全量单测在 `NO_PROXY=127.0.0.1,localhost` 下 **3763 通过 / 0 失败**（§3.5）。

**2026-10-22 增量（只读评审 → 干净克隆实测 → 加 CI；代码只动了格式与一处宏正确性）**：
- 新增 §11：两个只读子代理审计 + 我逐条按 `文件:行号` 复核的提交前评审。§10 第 6 项是索引。
- 今天新跑的复核（不是引用旧结论）：`src-legacy/` 与 tag `v3.20.4` 的 `diff -r` 退出码 0 / 两边各 462 文件 /
  10-19 01:00 之后无新 mtime；`src-legacy` 里 shim 与 i18n 泄漏 0 处；`allow(dead_code)` 抑制器 13 处；
  `Cargo.lock` 变更规模 485 增 / 189 删。
- 新实测（§11.3 ⑨）：rust-embed 缺目录是**硬编译错误**，最小 crate `cargo check --offline` 与真 crate 都复现了，
  实现在 `rust-embed-impl-8.13.0/src/lib.rs:487-489`。
- 新增 §12：干净克隆 A/B（`.ci-sandbox/`）、现有 CI 三门的本机预跑、新工作流说明、`.gitignore` 实际改动。
- **代码改动（就这两类，都为满足现有 CI 门）**：
  1. `cargo fmt --all`：19 个文件 / 29 处 hunk 的**纯格式**修正（改动集本来不满足 `ci.yml` 的 fmt 门）。
  2. `src-tauri/src/command_handler.rs`：宏体里 355 处 `crate::` → `$crate::`，
     消掉 clippy 的 `crate_in_macro_def`（`-D warnings` 会把它判成 error）。两个调用点都在本 crate，
     展开指向同一批函数，`cargo check --lib` 与 headless 侧都 exit 0。
  其余 §11 列的行为差异**一条都没动**。
- 新增文件：`tools/ci-local-clean-clone.sh`（干净克隆 A/B 复现脚本）、
  `.github/workflows/build-artifacts.yml`（`workflow_dispatch` 五选一：all / dist-legacy / headless-el9 / container / desktop）。
- `.gitignore`：补 `dist-legacy/`、`dist-legacy-desktop/`、`.ci-sandbox/`、`.e2e-home/` 与 `tools/` 下的一次性证据（§12.4）。

## 8. 复现命令

```bat
:: Windows 侧三道门（必须用 tools\rust.cmd；.cmd 里不要写中文注释，代码页会烂）
tools\gates.cmd
:: 全量 Rust 单测（NO_PROXY 是必需的，原因见 §3.5 / §9）
set NO_PROXY=127.0.0.1,localhost
tools\rust.cmd test --lib --features test-hooks
:: 倍率两条命令的真实往返（body 字段名是 cmd）
curl -X POST http://127.0.0.1:14515/api/invoke -H "Content-Type: application/json" -d "{\"cmd\":\"set_default_cost_multiplier\",\"args\":{\"appType\":\"claude\",\"value\":\"1.5\"}}"
curl -X POST http://127.0.0.1:14515/api/invoke -H "Content-Type: application/json" -d "{\"cmd\":\"get_default_cost_multiplier\",\"args\":{\"appType\":\"claude\"}}"
```
```bash
# 浏览器 E2E（真机 Chrome 走 CDP，含 SSE 帧断言 + 面板/表单文案断言）
node tools/browser-e2e.mjs

# 旧 UI 重新构建（debug 版无头服务直接读盘，改完文案不用重编二进制）
pnpm build:legacy:web && pnpm typecheck:legacy

# WSL 侧构建（注意 --config 清空 proxy；target 目录 /root/ccs-target）
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-build.sh

# EL9 容器构建 / 用新镜像重建容器并跑断言 / 验证 / 持久化 / 公网 token
# （顺序重要：只 build 不重建 ccs-e2e 的话，14517 上跑的还是旧包）
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-podman-build.sh
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-container-test.sh
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-verify.sh
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-persistence.sh
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-public.sh

# EL9 宿主差距实测（§5.3 / §5.3.1 的证据出处）
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-gap.sh /root/ccs-deploy/cc-switch-server
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-symcheck.sh /root/ccs-deploy/cc-switch-server
# 二进制是从容器里拷出来的：
#   podman cp ccs-e2e:/usr/local/bin/cc-switch-server /root/ccs-deploy/cc-switch-server
# LD_PRELOAD 反例（证明无效，见 §5.3.1）：
#   gcc -O2 -fPIC -shared -o /tmp/libhypot-shim.so tools/hypot-shim.c -Wl,--version-script=tools/hypot-shim.map
#   LD_PRELOAD=/tmp/libhypot-shim.so /root/ccs-deploy/cc-switch-server --help

# EL9 原生单二进制：构建 + 抽出 + 裸跑冒烟（§5.6 的证据出处，构建约 15 分钟）
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-native-build.sh
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-native-smoke.sh /root/ccs-deploy/cc-switch-server-el9
# 发布前守卫：产物内嵌的 UI 是不是最新构建（md5 对比 + 4 语言文案 + 倍率命令可用）
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-el9-copy-check.sh
# 构建前若 pnpm/cargo 报 ECONNREFUSED，先跑这个确认是"宿主代理被注进容器"而不是真断网（§9）
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-npm-egress-probe.sh
# github 直连性对照（容器 / 宿主无代理 / 宿主带代理）——决定能不能用 --http-proxy=false
MSYS_NO_PATHCONV=1 wsl.exe -u root bash /mnt/d/projects/ccs/tools/wsl-github-egress-probe.sh
# 链接方式对比探针（A 基线 / B -L / C 覆盖 libm.so 链接脚本）
MSYS_NO_PATHCONV=1 wsl.exe -u root bash -c 'cp /mnt/d/projects/ccs/tools/wsl-el9-link-order-probe.sh /root/lp.sh; podman run -i --rm -v /lib64:/el9lib:ro docker.io/library/rust:1-bookworm bash -s < /root/lp.sh'
```

## 9. 踩坑备忘（省你半天）

- **`MSYS_NO_PATHCONV=1`**：Git Bash 会把 `/mnt/d/...` 当 Windows 路径改写，必须加这个前缀。
- **`wsl.exe -u root bash script`** 是非登录 shell，`cargo` 不在 PATH，脚本里要 `. "$HOME/.cargo/env"`。
- **podman 喂脚本要 `-i`**：`podman run --rm img bash -s < script.sh` 不加 `-i` 会静默什么都不跑（退出码还是 0）。
- **长构建会被工具超时腰斩**：Agent 侧单条命令上限 10 分钟，`podman build`（cargo release 7m58s + 前端层）
  会踩线；被杀时 wsl.exe 返回 **0**，看着像成功，其实镜像没 COMMIT、tag 还指着旧版本
  （2026-10-21 就被这样骗过一次）。稳妥写法是把它**脱管**给 WSL 自己跑，再读日志：
  `wsl.exe -u root bash -c 'cd /mnt/d/projects/ccs && setsid nohup bash tools/wsl-podman-build.sh > /tmp/pb.out 2>&1 < /dev/null &'`
  然后 `tail /root/ccs-podman-build.log` + `podman images` 的 Created 时间来判断真假。
- **cargo fetch 挂住** → WSL `/root/.gitconfig` 里的 `http.proxy`。别改文件，加 `--config "http.proxy=\"\""`。
- **corepack `Cannot find matching keyid`** → 用 `npm install -g pnpm@10.12.3`。
- **E2E 假失败**：Chrome 自己探测 `/favicon.ico` 会产生 404 console error，`tools/browser-e2e.mjs` 已按 `entry.url` 归因过滤。临时 profile 目录删除会 EPERM，要等 chrome `exit` 再删（已加 `maxRetries`）。
- **管道会吞退出码**：`wsl.exe ... | tr | tail` 之后要用 `${PIPESTATUS[0]}`。
- **Windows → WSL 的 14518 端口连不上**（ping 通、iptables INPUT ACCEPT、代理 env 为空），已放弃这条路，改用"字节一致"作为等价证据。
- **固定 CDP 端口会把你骗了**：`--remote-debugging-port=9333` 若已被别的 Chrome 占着（本机是另一个项目的
  `newapi/tmp-e2e/chrome-profile2`），你 spawn 的 Chrome 会退到随机端口，而脚本连上的是**那台陌生浏览器**，
  于是断言跑在别人的 profile / 别人的 localStorage 上，出现莫名其妙的外设状态（这次表现为"已经在设置页"）。
  `tools/browser-e2e.mjs` 现在用 `net.listen(0)` 现挑空闲端口；再遇到"DOM 状态与代码不符"先怀疑这条。
- **旧 UI 的语言是异步定的**：`i18n` 先用 `navigator.language`（无头 Chrome = en-US）渲染，
  设置加载完再切到库里存的简体中文。所以**任何按中文文案写的 DOM 断言都可能间歇失败**，
  要么四种语言都匹配（E2E 里的 `NOTE` 正则），要么按 `id` / `aria-controls` / lucide 图标类名定位。
- **Radix 折叠项的 `aria-controls` 在这个 UI 里就是内容元素 id**（`radix-:r1u:`），没有 `-content-pricing` 这种
  后缀可用；面板定位改用 `button:has(svg.lucide-coins)`，内容用 `getElementById(trigger.ariaControls)`。
- **`.cmd` 里不要写中文注释，也别只用 LF**：`cmd.exe` 会在多字节 + 无 CR 的 `rem` 行上吐出
  `'??' is not recognized as an internal or external command`，看着像构建失败。`tools/rust.cmd` 已改成 ASCII。
- **本机跑 Rust 单测要带 `NO_PROXY=127.0.0.1,localhost`**：reqwest 在 Windows 上除了环境变量还会读
  **注册表里的系统代理**，于是"连一个已释放的随机端口 expecting ECONNREFUSED"这类测试会被 127.0.0.1:7890
  代答成 502（详见 §3.5 那三组对照）。这不是回归，别去改测试。
- **`podman build` 默认会把宿主的代理注进构建步骤**（`--http-proxy` 默认 true）。WSL 宿主里挂着
  `http(s)_proxy=http://127.0.0.1:7890`（Windows 代理经镜像网络透传进来的），而这个地址在容器的 netns 里
  根本不存在 → 2026-10-20 那次重编就在 `pnpm install` 上以一片 `ECONNREFUSED` 失败（日志
  `/root/ccs-el9-native.log`）。容器**直连** registry 与 index.crates.io 实测都是 200
  （`tools/wsl-npm-egress-probe.sh`，三种网络模式各测一遍），所以正解是给两个构建脚本加
  `--http-proxy=false`，**不要**改成 `--network=host` 或往容器里塞代理。已改：
  `tools/wsl-el9-native-build.sh`、`tools/wsl-podman-build.sh`。
  **前提是本仓库的依赖全走 registry**（`grep -c "source=git" src-tauri/Cargo.lock` = **0**，npm 也是 registry）。
  **github 在这台机器上是直连不通的**（`tools/wsl-github-egress-probe.sh` 实测：容器 bridge 无代理
  `UND_ERR_CONNECT_TIMEOUT`、WSL 宿主清掉代理 env 后 curl `(28) Connection timed out`、带上宿主代理才 200），
  所以以后若引入 **github 之类的 git 依赖**，`--http-proxy=false` 会让它拉不下来 —— 那时要给构建显式喂一个
  **容器可达**的代理地址（宿主 `127.0.0.1:7890` 在容器 netns 里不存在，得用宿主机 IP 或 `--network=host`），
  而不是回退到默认注入。
- **构建脚本必须自己 `exit $st`**：`tools/wsl-podman-build.sh` 原来在 `tail -30` 之后就结束了，
  退出码变成 tail 的 0，`wsl.exe` 那边看着像成功。已补 `[ "$st" -ne 0 ] && exit "$st"`。
  同理，Windows 侧 `cmd ... > /dev/null 2>&1; echo exit=$?` 这种写法，最终退出码是 **echo** 的，
  要的就是这个数的时候别把 `$?` 丢掉。
- **Windows 上必须用 `tools\rust.cmd`**：仓库的 `rust-toolchain.toml` 把 GNU 工具链设成 active（本机 rustup
  的 default host 是 gnu），直接 `cargo` 会撞 `dlltool.exe: program not found`。wrapper 用
  `RUSTUP_TOOLCHAIN=1.95-x86_64-pc-windows-msvc` 覆盖它（`+toolchain` 命令行参数覆盖不了 toolchain 文件）。
- **`--no-default-features --features headless` 跑不了 `cargo test --lib`**：`lib.rs` 的 `#[cfg(test)]` 里
  import 了 desktop 才有的 `classify_exit_request`（E0432）。单测请用默认 desktop 特性跑。
- **上游那个"绑随机端口再释放、期望连接被拒"的测试在本机必现 502**（`proxy::error::tests::describe_reqwest_error_keeps_cause_and_drops_url`）：
  抢着应答的是**本机的 Windows 系统代理**（reqwest 读注册表，不是环境变量），不是回归。
  跑测试时带 `NO_PROXY=127.0.0.1,localhost` 就绿；三组对照实验见 §3.5 备注。
- **cargo/pnpm 与 `tail` 串起来会丢退出码**：`pnpm typecheck:legacy 2>&1 | tail -20` 报了 exit 0 但其实
  tsc 是 exit 2。要么 `> file 2>&1; echo exit=$?`，要么 `${PIPESTATUS[0]}`。

## 10. 建议的下一步（按性价比排序）

1. ~~EL9 原生可行性~~ —— **已解决**，见 §5.6。`deploy/Dockerfile.old-glibc`（zig 废案）**已按用户指示删除**，
   `deploy/` 现在只剩 `Dockerfile`（容器镜像）+ `Dockerfile.el9-native`（原生二进制）+ `cc-switch-server.service`。
2. ~~成本倍率决策~~ —— **已按走法 1 实施并验证**（§6.1）。
3. ~~重新构建部署产物~~ —— **2026-10-21 已完成并复验**：EL9 原生二进制（sha256 `a6d2346d…`）与
   容器镜像 `:dev`（`03e4b1ffea13`）都含新命令与新文案，页面资源与本地构建逐字节一致（§3.5 末三行、§5.6）。
   坑在构建参数：必须 `--http-proxy=false`（§9）。
4. §6.2 桌面版跑旧 UI（`tauri.conf.json` 还指向 v4 UI）。倍率文案的 alias 已经对两种模式都生效，
   这一步只差把 `frontendDist/devUrl` 指到 `dist-legacy` 并解决 tauri 说明符被 alias 吞掉的问题。
   这是**目前唯一剩下的功能活**。
5. ~~§6.3 清理~~ —— 本机现场**已清理完毕**（2026-10-20 收尾，见 §6.3）。
6. **提交前先读 §11**（2026-10-22 的只读静态评审，逐条带 `文件:行号` 与复核命令）。
   11.1 那 **5 条是行为/交付形态决策**（Cargo.lock 整栈被动升级、`app_store.rs:29-43` 环境变量优先级、
   `stream_check.rs:24` default→DB、`setup.rs:104` 的 cfg 语义、`dao/proxy.rs:136-139` 读里带写），
   11.3 那 **4 条是提交前必须处理的仓库卫生**（`.gitignore` 缺口、`assets.rs:4` 嵌入未跟踪目录、
   机器绝对路径、一次性改写脚本）。**这些我都只报告没动手改**，包括看起来该删的 `*_test_hook`（§11.2）。

   > **2026-10-22 更新**：改动集**已提交并推送**（一个 commit，578 个入口：`src-legacy/` 462 个文件、
   > `src-tauri/` 54、`tools/` 35、`web/` 15、`deploy/` 3 + 配置/文档/`.github`）。`.e2e-home/`、
   > `dist-legacy/`、`src-tauri/target/`、`.ci-sandbox/` 都靠新补的 `.gitignore` 挡在外面（§12.4），
   > 没有 `git add -A` 误带。**§11.1 / §11.2 的决策项和 §11.3 的 ⑩⑪ 仍未处理**，push 到 main 会触发
   > `ci.yml`（三门 Rust + 前端 job）——本机证据见 §12.2，push 后**六个 job 全绿**，
   > 那 3 个 vitest 本机失败在 CI（ubuntu + node 20）上不复现（实测见 §12.5）。

### 10.1 部署原生二进制到 EL9 的现成路径
`deploy/cc-switch-server.service` 的 `ExecStart=/usr/local/bin/cc-switch-server`
对 §5.6 的原生产物**同样适用**（那个 unit 本来就是给裸二进制写的）：
```bash
podman create --name x localhost/cc-switch-server:el9
podman cp x:/cc-switch-server /usr/local/bin/cc-switch-server && podman rm x
systemctl enable --now cc-switch-server
```
对外监听要在 `/etc/cc-switch/server.env` 里给 `CC_SWITCH_TOKEN`，否则程序拒绝非 loopback 绑定。

## 11. 提交前静态评审（2026-10-22，**只读**，未改任何代码）

两个只读子代理对整个未提交改动集做了审计，我**逐条按 `文件:行号` 复核**后才写在这里
（复核命令都附在下面，可直接重跑）。本轮**没有修改任何业务代码**——按 §2 的约束，行为差异只报告、由你决定。

工作区体量：42 个已跟踪文件被改（`git status --porcelain | grep '^ M'`），20 项未跟踪。

> 时间线补充：本节评审本身是只读的。之后为了过现有 CI 门（见 §12.2）实际只动了两处——
> `cargo fmt --all`（19 个文件，纯格式）与 `command_handler.rs` 的 355 处 `crate::`→`$crate::`
> （宏正确性，展开结果不变）。**§11.1 / §11.2 列的那些行为和卫生问题一律没碰**，仍等你拍板。

### 11.1 必须你拍板（会改变行为或交付形态）

**① `src-tauri/Cargo.lock` 整份 tauri 栈被动升级**（485 增 / 189 删：`git diff --numstat -- src-tauri/Cargo.lock`）
- 触发点：`Cargo.toml` 做 feature 拆分（`default = ["desktop"]`、`tauri` 改成 `default-features = false`、
  一批插件与 `gtk`/`webkit2gtk` 转 `optional` 挂到 `desktop`）。依赖图重新求解后
  `tauri 2.10.3→2.12.4`、`tauri-runtime 2.10.1→2.12.2`、`wry`、`muda`、`tray-icon`、`window-vibrancy`、
  `brotli 8→9`、`aws-lc-sys 0.36→0.37` 全涨到 semver 区间上限。
- **不是我们抬的下限**：`Cargo.toml` 里 tauri 仍然写 `"2.8.2"`（diff 里只改了 `features`/`default-features`）。
- 现在交付的 EL9 原生二进制与容器镜像**就是按这份 lock 编的**，§3.5 / §5.6 的全部实测证据都建立在它上面。
- 可选：**(a) 接受**（风险已被实测覆盖）；**(b)** `cargo update --precise` 逐项钉回原版本再全量复验
  （成本高，而且旧版本上 `tauri/test` MockRuntime 是否同样强拉 gtk/webkit 未测——§5.1 的证据是 2.12.x 的）。
- 提醒：**绝不手改 lock**（§2），要动就用 cargo 子命令让它自己写。

**② `src-tauri/src/app_store.rs:29-43` — 环境变量优先级没有 feature 门**
`get_app_config_dir_override()` 先看 `CC_SWITCH_DATA_DIR`（`:36-43`），命中就直接返回，**盖过** Store 里的
`app_config_dir_override`。这在无头场景是对的（`--data-dir` 就该赢，旁边的中文注释写了理由），
但**桌面版同样走这条路径**：桌面用户环境里恰好有这个变量时，设置页选的路径会被静默压掉。
可选：**(a) 保持**；**(b)** 给 env 分支加 `#[cfg(not(feature = "desktop"))]`；**(c)** 只在无头入口里 setenv。

**③ `src-tauri/src/commands/stream_check.rs:24`（及 `:45`）— 探测配置从 default 改成读 DB**
上游单个探测用的是 `StreamCheckConfig::default()`（见 `git diff -- src-tauri/src/commands/stream_check.rs`），
我们改成 `state.db.get_stream_check_config()?`。**这是可观察的行为变化**：桌面版在设置里改过超时/重试/并发后，
连通性检查真会按它跑（之前恒为默认值）。旧 UI 必须这样（v3 就读 DB），但桌面端属于顺带改变。

**④ `src-tauri/src/setup.rs:104` — `cfg(desktop)` 被换成 `feature = "desktop"`，两者不是一回事**
上游是 `#[cfg(desktop)]`（tauri-build 产出的 **target family** cfg，Linux 构建里恒真，
见 `git show HEAD:src-tauri/src/lib.rs` 第 532 行），我们写成 `#[cfg(feature = "desktop")]`。
同型的还有 `setup.rs:100`（`target_os = "windows"` → `all(target_os = "windows", feature = "desktop")`）。
净效果：无头二进制**不注册 Updater 插件**、不设 Windows AppUserModelID。大方向应该正是你要的
（服务器不该自检更新），但它同时改了桌面 Linux 的等价性判断，后续接手**别把这两个 cfg 混用**。

**⑤ `src-tauri/src/database/dao/proxy.rs:136-139` — 读操作里藏了一次写**
`get_default_cost_multiplier` 查不到行时调 `init_proxy_config_rows()` 补行再返回 `"1"`，
即"GET 会写库"。同文件 `get_pricing_model_source`（`:170` 起）是对照写法。
可选：**(a)** 保留自愈语义；**(b)** 改成纯读、缺行直接返回默认值。

### 11.2 建议清理（我们新增代码里的冗余）

**⑥ `src-tauri/src/commands/proxy.rs:350` / `:383` 两个 `*_test_hook` 零调用者**
全仓 `grep -rn "cost_multiplier_test_hook" --include=*.rs .` 只有这两行定义，没有调用点。
单测在 DAO 层（`src-tauri/src/database/dao/proxy.rs:933,947`），没有经过命令层。
上游这个模式是给**集成测试**用的：`import_default_config_test_hook` 被
`src-tauri/tests/golden/import_rows.rs:143`、`src-tauri/tests/mcp_commands.rs:309` 等真实调用。
（附带说明：`commands/provider.rs:157 switch_provider_test_hook` 在本仓库 HEAD 里就已经零调用，
**不是**这次改动造成的，别顺手清。）
可选：**(a)** 删掉这两个 hook（符合 §2 极简主义）；**(b)** 补一个命令层集成测试把它们用起来。

**⑦ 13 处 `#[cfg_attr(not(feature = "desktop"), allow(dead_code))]`**
`grep -rc 'cfg_attr(not(feature = "desktop"), allow(dead_code))' src-tauri/src --include=*.rs` 合计 **13**，
全部由 `tools/quiet-headless-warnings.mjs` 一次性插入，模式统一，不是逐处手写的魔法。
价值判断留给你：它们压掉的是"桌面版才用、无头版编不进"的死重，读代码时会遮住真实引用关系。

### 11.3 提交前必须处理（仓库卫生）

**⑧ `.gitignore` 缺口**（现表 34 行，有 `dist/`、`*.log`，**没有**下面这些）—— **2026-10-22 已补，见 §12.4**
- `.e2e-home/` — **12 MB** 的 E2E 数据目录：`cc-switch.db`、`.cc-switch/cc-switch.db`、
  `backups/db_backup_20261020_205749.db`、`backups/db_backup_20261021_222501.db`、`.cc-switch/settings.json`、
  `.claude/settings.json`（内含假 key `sk-e2e…` 与探针地址 `127.0.0.1:18099`）。`git add -A` 会整包带走。
- `dist-legacy-desktop/`（§6.2 验证时的临时产物，已删，但仍可能被再次生成）。
- `tools/` 下的一次性产物：`desktop-check.txt`、`headless-check.txt`、`headless-build.txt`、
  `legacy-web-build.txt`、`legacy-commands.txt`、`tree.txt`、`cmd-diff.json`、`lib.rs.bak`、
  `hypot-shim.c`、`hypot-shim.map`。**别直接删**：`hypot-shim.*` 是 §5.3.1 反例的存档，
  `cmd-diff.json` 被 §6.2 引用，`lib.rs.bak` 是拆模块前的快照（§6.3 说明为何先别删）
  → 用精确的 ignore 规则排除，而不是删文件。

**⑨ `src-tauri/src/headless/assets.rs:4` — `#[folder = "../dist-legacy"]` 嵌入的是未跟踪目录（已实测：干净克隆**必编不过**）**
rust-embed 在**编译期**读盘，目录不存在就直接报 `error: #[derive(RustEmbed)] folder '...dist-legacy' does not exist`。
`dist-legacy/`（5.4 MB 前端产物）当前未被跟踪，所以 clone 后不跑前端构建就一定编不出无头版。
实测证据（2026-10-22，最小复现，不是推断）：临时 crate 里
`#[derive(rust_embed::RustEmbed)] #[folder = "../definitely-missing"]` + `cargo check --offline`
→ **exit 1**，报错文本就是上面那句；实现在 `rust-embed-impl-8.13.0/src/lib.rs:487-489`（`!exists() && !allow_missing`）。
可选：**(a)** 把 `dist-legacy/` 纳入版本库（构建产物入库，上游风格一般拒绝）；
**(b)** 明确 ignore + 把"先 `pnpm build:legacy:web` 再 `cargo build --no-default-features --features headless`"
写进 `deploy/` 与 README（**推荐**，这就是现在 §8 的实际步骤，只是没写在给外人看的地方）。
**别用 `#[allow_missing = true]` 糊过去**（`rust-embed-impl-8.13.0/src/lib.rs:444,521` 支持它）：
那只会让它编过但资源为空，页面全 404，属于把显式失败换成静默失败。
→ **2026-10-22 走的是 (b)**：`dist-legacy/` 已加进 `.gitignore`，构建顺序写进 §12.1 的实测与
新工作流（`deploy/Dockerfile*` 本来就自带前端构建，不受影响）。

**⑩ 机器相关路径与陈旧路径**
- `tools/rust.cmd:3-5`：`C:\Program Files\Microsoft Visual Studio\18\...`、`C:\Users\admin\.cargo\bin`、
  `D:\projects\ccs\src-tauri`；`tools/gates.cmd:3-5` 同样写死 `D:\projects\ccs\...` 与日志绝对路径。换机器即失效。
- `tools/wsl-el9-runtest.sh:7`：`BIN=/root/cc-switch-server-el9`，与 §6.3 及其他脚本用的
  `/root/ccs-deploy/cc-switch-server-el9` **不一致**（旧位置）。

**⑪ 一次性改写脚本＝地雷**
- `tools/extract-setup.mjs:105-118`：往 `src-tauri/src/lib.rs` **重写**内容（把 setup 闭包搬进 `setup.rs`）。
- `tools/quiet-headless-warnings.mjs:10-28`：按**硬编码行号**往 20 个文件插 `#[cfg(...)]`（带锚点字符串校验）。
两者"跑一次就完事"，**现在重跑会插坏或错位**。要么不提交，要么在文件头写明"存档、禁止重跑"。

### 11.4 复核过的、确认没问题的（今天新跑的，不是引用旧结论）
- `src-legacy/` 不变量：与 tag `v3.20.4` 的 `src/` **462 个文件 `diff -r` 退出码 0**，
  且 `find src-legacy -type f -newermt '2026-10-19 01:00'` = **0**（本轮确实没动过）。
  复现：`rm -rf /tmp/a && mkdir /tmp/a && git archive v3.20.4 src | tar -x -C /tmp/a && diff -r /tmp/a/src src-legacy`
- shim / i18n 泄漏：`grep -rn "web/transport\|web/i18n\|@tauri-apps/api/core.js" src-legacy` = **0 处**。
- 倍率命令的注释与实际一致：`commands/proxy.rs:359-364` 声明"只读写这一列、v4 计费不消费"，
  与 §6.1 核实过的 `proxy/usage/logger.rs` 传 `Decimal::ONE` + 守卫测试相符。

## 12. 本地干净克隆实测 + GitHub Actions（2026-10-22）

### 12.1 干净克隆 A/B 实测（`tools/ci-local-clean-clone.sh`，沙箱 `.ci-sandbox/repo`）
做法：tar 复制工作树（排除 `.git node_modules dist dist-legacy* src-tauri/target .e2e-home *.log`，
2182 个文件）→ `pnpm install --frozen-lockfile --offline`（9s，480 包全走本地 store）→
`pnpm build:legacy:web`（14s）→ 在沙箱**自己的 target 目录**（1.4 GB，确认没蹭主仓缓存）跑 cargo check。

结果（全部是这轮实测，不是引用旧结论）：
- **前端可复现**：沙箱产物 `assets/index-0hufZJV7.js` md5 `36d6ce687c924c223f220fa06fcb8d38`，
  与主仓现有 `dist-legacy` 同一个 md5，也和两个已交付产物内嵌的页面一致 → 构建确定性成立。
- **反向对照**（把沙箱的 `dist-legacy` 移走）：
  `cargo check --no-default-features --features headless --lib --bin cc-switch-server` → **exit 101**，
  报错原文 `error: #[derive(RustEmbed)] folder 'D:\projects\ccs\.ci-sandbox\repo\src-tauri\../dist-legacy' does not exist.`
  → §11.3 ⑨ 在**真 crate** 上成立（此前只是最小 crate 探针）。
- **正向**（放回去，同一份依赖图）：**exit 0**（39s）。
- 顺带一条给 CI 的事实：无头构建**不需要** `../dist`（沙箱刻意没复制 `dist/`，仍编得过），
  所以 headless job 只要保证 `dist-legacy` 先出来就行。
- 复现命令：`bash tools/ci-local-clean-clone.sh`（日志 `tools/ci-local-clean-clone.log`、
  `tools/ci-local-negative.log`、`tools/ci-local-positive.log`）。
- 这轮踩的三个本机坑（已写进脚本注释）：`.cmd` 必须 **CRLF**（LF 版报
  "The syntax of the command is incorrect."）；Git Bash 里 `cmd.exe /c` 会被 MSYS 当路径转换，要写 `//c`；
  heredoc 里的 `>nul` 会被 MSYS 改写成 `>/dev/null`。

### 12.2 提交前必须过的**现有** CI 门（`ci.yml` 在 push 到 main 就会跑）
- `cargo fmt --check`：审计发现改动集**不干净**（19 个文件 / 29 处 hunk，含 `bin/server.rs`、
  `app_store.rs`、`commands/config.rs`、`headless/*.rs` 等）→ 已 `cargo fmt --all` 修正，
  现在 `cargo fmt --check --all` **exit 0 / 0 处 diff**。这 19 个文件的 HEAD 版本单独跑 rustfmt 是干净的，
  说明格式漂移是本次改动引入的，不是上游遗留。**纯格式，无行为改动。**
- `pnpm typecheck:legacy`：**exit 0**（已作为守卫加进新工作流）。
- **前端三门实测**（`package.json` 被我们改了，push 到 main 一定会触发 `frontend` job）：
  `pnpm typecheck` **exit 0**、`pnpm format:check` **exit 0**（"All matched files use Prettier code style!"）、
  `pnpm test:unit` **exit 1**（5 文件 / 7 用例失败）。
  **已用 A/B 证明这 7 个与我们的改动无关**：`git diff -- package.json` 只加了 5 条 script，
  依赖与 `pnpm-lock.yaml` 一行没动，`src/`、`tests/`、`vite.config.ts`、`vitest.config.ts` 也都没碰。
  把失败的那 5 个文件单独重跑 → 只剩 **3** 个稳定失败（另外 4 个是并发抢 CPU 的时序抖动）；
  再在**纯净 HEAD 沙箱**里跑同一批（`.ci-sandbox/head-baseline`，`git archive HEAD` + `pnpm install --frozen-lockfile --offline`）
  → **同样 3 failed / 104 passed**，失败用例名逐条相同：
  `rememberedChoice.test.ts > keeps working when storage is unavailable`、
  `UsageDashboard.test.tsx > draws the request log with the columns picked in settings`、
  `UsageDashboard.test.tsx > wires the tabs to the tabpanel and supports arrow / Home / End keys`。
  → 结论：**本机 Node 26 环境下的既有失败**，不是本次改动引入。CI 用的是 ubuntu + node 20，
  push 后那一跑**实测是绿的**（§12.5：`Unit tests` step 08:19:31→08:23:34 success）；
  别把它们算到这次改动头上，也别顺手去"修"。
- `cargo clippy -- -D warnings`：**第一跑就抓到一处真问题**，就在我们新增的
  `src-tauri/src/command_handler.rs:9`（整个文件 5-407 行就是那个 `#[macro_export] macro_rules!`）——
  宏体里 355 处 `crate::` 会被 clippy 判为 `crate_in_macro_def`：`crate` 在导出宏里指向的是
  **调用方**的 crate，不是定义方。已全量改成 `$crate::`（`sed -i 's/\bcrate::/$crate::/g'`，
  替换 355 处、残留 0 处），改完 `cargo check --lib` **exit 0 / 15.03s**。
  两个调用点 `lib.rs:509`、`headless/bootstrap.rs:97` 都在本 crate 内，展开结果与改前指向同一批函数，
  所以这是**修正确性而非改行为**；但要记住：这类"宏里写 `crate::`"的坑只有 clippy 会报，
  `cargo check` 不报——别把 gates 当成唯一门槛。
- **修正后全部复跑一遍**（2026-10-22，均走 `tools/rust.cmd`，MSVC 1.95）：
  `cargo clippy -- -D warnings` **exit 0 / 48.25s**、`cargo check --lib` **exit 0**、
  `cargo check --no-default-features --features headless --lib --bin cc-switch-server` **exit 0**、
  `cargo test --lib --features test-hooks` **exit 0**：
  `3763 passed; 0 failed; 11 ignored; finished in 41.01s`（这条同样要带
  `NO_PROXY=127.0.0.1,localhost`，理由见 §3.5 备注；长任务用 `powershell Start-Process` 脱离终端跑，
  日志落盘后再读，别信管道里的即时 exit code）。
- 工具链一致性：`rust-toolchain.toml` 的 `channel = "1.95"` 与本机 `tools/rust.cmd` 强制的
  `1.95-x86_64-pc-windows-msvc` 同版本，所以本机 rustfmt/clippy 的判定和 CI 用的是同一套。
  顺带：本机 msvc toolchain 原本**没装 clippy 组件**（`rustup component add clippy` 补上，
  否则 `cargo clippy` 直接报"not installed"，容易误判成代码问题）。
- **桌面特性等价性已核对**（这是 §11.1 ① 那批 Cargo.toml 改动最该验的一条）：
  `tauri 2.12.4` 的 `[features].default = ["wry","compression","common-controls-v6","dynamic-acl","x11","dbus"]`
  （registry 里 `tauri-2.12.4/Cargo.toml`），与我们 `desktop` 特性逐条列出的完全对齐，
  外加上游本来就显式声明的 `tray-icon`/`image-png`；`protocol-asset`/`macos-private-api` 改成常驻
  （`build.rs` 的 capability 校验需要）。→ **拆特性没让桌面构建丢任何默认特性**，
  这条不再是风险，只有 headless 侧是新的特性组合。

### 12.3 新工作流 `.github/workflows/build-artifacts.yml`（手动触发，`target` 五选一）
`workflow_dispatch` 的 `target` 选项：`all` / `dist-legacy` / `headless-el9` / `container` / `desktop`。
不挂 push/PR：桌面与容器构建各自要拉几百 MB 依赖，成本不该摊给每次提交。

- `preflight`：`git archive v3.20.4 src | tar -x` + `diff -r src-legacy` + 文件数比对，
  **四个构建 job 全部 `needs: preflight`** —— 把 §2 的第一原则变成 CI 守卫，而不是靠人记得。
- `dist-legacy`：corepack 装 pnpm（读 `packageManager: pnpm@10.12.3`）、node 22（与
  `deploy/Dockerfile` 的 `node:22.12.0-slim` 对齐）→ `pnpm install --frozen-lockfile` →
  `typecheck:legacy` → `build:legacy:web` → 打印文件数与 index js 的 md5 → 上传 artifact。
- `headless-el9`：`docker build -f deploy/Dockerfile.el9-native` →
  `docker create` + `docker cp /out/cc-switch-server` → **守卫**（`readelf -V` 最高 GLIBC 需求必须 ≤ 2.34，
  `readelf -d` 的 DT_NEEDED 里不许出现 webkit/libsoup）→ **在 `quay.io/centos/centos:stream9` 最小容器里实测**：
  先"裸 EL9 不装任何包"跑 `--help` 把缺什么写进日志（不致命，这正是要观察的事实），再
  `dnf install gtk3 curl` 后起服务，验 `/api/health`、`/api/invoke` 的 `get_default_cost_multiplier`、
  首页 `<title>`、SIGTERM 退出码 → 上传单二进制。
- `container`：`docker build -f deploy/Dockerfile` → 带 `CC_SWITCH_TOKEN` 起容器 →
  health / 倍率 set+get（`Authorization: Bearer`，见 `headless/server.rs:105-128`）/ 首页 title →
  **无 token 必须 401** → `docker save` 上传 tar。
- `desktop`：`windows-2022`(msi) + `ubuntu-22.04`(appimage,deb,rpm) 矩阵，系统依赖照抄 `release.yml`；
  **它构建的是 `tauri.conf.json` 现值 = v4 UI**，§6.2 还没拍板，别把这个 job 当成"旧 UI 上桌面已完成"；
  `--config '{"bundle":{"createUpdaterArtifacts":false}}'` 关掉更新签名产物（这条流没有私钥，
  不关会停在 "A public key has been found, but no private key"）。
- 缓存：pnpm store 用 `pnpm store path --silent` 探测（与 `ci.yml` 同法，别写死路径）；
  Rust 用 `shared-key: backend` 蹭 `ci.yml` backend job 的依赖缓存。
- YAML 已本地校验：`python -c "yaml.safe_load(...)"` 通过，5 个 job、无 tab、dispatch 选项 5 个。
  **注意：这些 job 还没在 GitHub 上真跑过**，第一次跑大概率还要修（apt 包名、EL9 容器里 curl 可用性、
  bundling 工具下载）。

### 12.4 `.gitignore` 实际补了什么（2026-10-22）
贴在文件末尾的一块：`dist-legacy/`（前端产物，构建顺序见 §12.1）、`dist-legacy-desktop/`
（§6.2 桌面模式验证的临时产物）、`.ci-sandbox/`（本地干净克隆沙箱，含 1.4 GB `target/`）、
`.e2e-home/`（14515 在用的 E2E 数据目录：`cc-switch.db`、`backups/db_backup_*.db`、
`.claude/settings.json` 里的假 key `sk-e2e…`），以及 `tools/` 下那批一次性落盘证据
（`tools/*.txt`、`cmd-diff.json`、`lib.rs.bak`、`hypot-shim.c`、`hypot-shim.map`）。
- `*.log` 本来就在表里，所以 `tools/e2e-server.log`、本轮新增的 `tools/ci-local-*.log`、
  `tools/ci-clippy*.log` 自动不入库。
- **仍然入库**的 `tools/` 内容：`cmd-compat.md`（§5/§6.1 引用的证据文档）、`cmd-diff.mjs`、
  全部 `wsl-*.sh`、`browser-e2e.mjs`、`ci-local-clean-clone.sh`，以及 §11.3 ⑪ 点名的
  `extract-setup.mjs` / `quiet-headless-warnings.mjs`——按"整包提交"它们进了版本库，
  **重跑会插坏**这条风险没有消失，只是被 §11.3 ⑪ 记录在案；要摘出去随时说。
- 提交前的 staging 预览（`git add -A --dry-run`）：**578 个条目** =
  `src-legacy` 462 + `src-tauri` 54 + `tools` 35 + `web` 15 + `deploy` 3 + 配置/`docs`/`.github`/`.gitignore`/`.dockerignore`。
  `.e2e-home/`、`dist-legacy/`、`src-tauri/target/` 都不在里面。

### 12.5 push 后 CI 实测（2026-10-22，run `39746762224`）——**全绿**
`git -c http.proxy=http://127.0.0.1:7890 push origin main` → `77c6dc79..0912b6c1`，一个 commit
`578 files changed, 124067 insertions(+), 1657 deletions(-)`。
push 到 main 触发 `ci.yml` run #1：<https://github.com/zhaoyj7/cc-switch/actions/runs/39746762224>
**6 个 job 全部 `success`**（结论从 API 逐 step 读，不是看页面印象：
`curl -x http://127.0.0.1:7890 .../actions/runs/39746762224/jobs` 再按 `steps[].conclusion` 汇总）：
- `Detect changed areas` success——`package.json` + `src-tauri/**` + `.github/workflows/**` 都改到，两侧 job 都被拉起。
- `Frontend Checks` success：typecheck 24s、format:check 9s、**Unit tests 08:19:31→08:23:34 绿**、`build:renderer` 15s。
  → §12.2 那 3 个本机失败在 CI（ubuntu + node 20）**不复现**。"本机 Node 26/Windows 专属"从推断升级为实测，
  这也解释了为什么 §12.2 说"别顺手去修"是对的。
- `Backend Checks` 三平台矩阵（windows-latest / ubuntu-22.04 / macos-latest）全绿：
  `Check Rust formatting` 各 4-5s、`Clippy`（`-D warnings`）分别 4m31s / 3m11s / 3m54s、`Run tests` 14m25s / 6m35s / 9m39s。
  两条以前只有本机证据的事，现在拿到跨平台证据：
  ① **本机 clippy 只能在 Windows/MSVC 上跑**，`#[cfg(unix)]` 与 macOS 分支从来没被 lint 过——CI 补上了这个盲区，
  没有额外 lint 冒出来（`$crate` 那处修完在三个平台上都干净）。
  ② 本机 `cargo test` 那两个"失败"归因于系统代理（§3.5）；CI 没带 `NO_PROXY` 也全绿，**反证了那条根因判断**。
- `Backend Checks (Windows + WSL2 home)` success，两个 ignored 契约测试分别 4s / 25s。

`.github/workflows/build-artifacts.yml` 已被 GitHub 注册成 `state: active`（能列出来就说明 YAML 过了它的解析），
本地复验：`python3 -c "yaml.safe_load(...)"` → 5 个 job（`preflight/dist-legacy/headless-el9/container/desktop`）、
dispatch 选项 5 个、文件里 0 个 tab。**但它自己的 job 一次都没跑过**——只有手动 dispatch 才跑，我没替你点
（CI 分钟数是共享资源）。要试先跑最便宜的那条：`target=dist-legacy`（单 ubuntu job，装依赖 + 构建 + md5，约 3-5 分钟）。

EL9 那道 glibc 门做了**离线判定表实测**（不必等构建产物就能验它的逻辑）：
```bash
for v in 2.5 2.17 2.23 2.27 2.28 2.31 2.33 2.34 2.35 2.36 2.38 2.39 2.40 2.41 2.42 3.0 ""; do
  case "GLIBC_$v" in GLIBC_2.3[5-9]*|GLIBC_2.[4-9][0-9]*|GLIBC_[3-9]*) echo "$v REJECT";; *) echo "$v accept";; esac
done
```
→ **≤ 2.34 全 accept、≥ 2.35 全 REJECT**，含真实存在的 2.40/2.41/2.42（Ubuntu 24.04/25.04 就是这几个版本）。
`sort -uV` 取最高值也没问题：`2.2.5/2.3.4/2.27/2.14/2.34`→`2.34`；`2.2.5/2.34/2.35/2.4`→`2.35`；
`2.2.5/2.40/2.9`→`2.40`（逐数字段比较，不会被"字典序里 `2.9` 最大"骗过去——这正是这道门最容易写错的地方）。
表里唯一暴露的洞：**`max` 为空串时 `case` 一条都不匹配 → 这道门形同不存在**（`readelf` 挂了或 grep 没命中就会静默放行）。
已补 `[ -n "$max" ] || exit 1`（`.github/workflows/build-artifacts.yml:147`）——按 §2 的约束，守卫本身失效比误报更危险。
