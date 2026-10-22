# 旧前端（v3.20.4）→ 新后端（v4.0.15）命令兼容清单

由 `node tools/cmd-diff.mjs` 生成明细（`tools/cmd-diff.json` 是原始数据），
逐条已回读源码确认，不含推断。

- v3.20.4 注册命令 304 条，v4.0.15 注册 349 条（v4 新增 51 条，删除 6 条）
- 旧前端实际 `invoke()` 的站点 279 处
- 参数名（camelCase）不匹配：**0 处**——v4 未改任何参数的对外拼写，
  已用无头服务实测确认：`{"appType":"claude"}` 通过，`{"app_type":"claude"}` 报
  `missing required key appType`

## 一、v4 已删除、旧前端仍在调用（6 条，必须处理）

| 命令 | 旧前端调用处 | v4 现状 | 处理方式 |
| --- | --- | --- | --- |
| `get_default_cost_multiplier` | `lib/api/proxy.ts:74` → `components/usage/PricingConfigPanel.tsx:88` | 列还在库（`database/schema.rs:139,1489,1516`），DAO 读写与命令都已删除；**且 v4 整条计费链路写死倍率 1**：`proxy/usage/logger.rs:405` 传 `Decimal::ONE`，`services/session_usage*.rs` 全部 `let multiplier = Decimal::from(1)`，`proxy/response_processor.rs:1232` 的测试名直接叫 `test_log_usage_ignores_legacy_multiplier_and_provider_overrides` | ✅ 已补命令 + 面板加说明（见第五节） |
| `set_default_cost_multiplier` | `lib/api/proxy.ts:82` | 同上 | ✅ 同上 |
| `get_stream_check_config` | `lib/api/connectivity-check.ts:54` → `components/usage/ConnectivityCheckConfigPanel.tsx:35` | `StreamCheckConfig` 结构体还在（`services/stream_check.rs:40`：timeout_secs / max_retries / degraded_threshold_ms），但 v4 只用 `StreamCheckConfig::default()`（`commands/stream_check.rs:32`），配置表 `stream_check_config` 已不存在（schema 里只剩 `stream_check_logs`） | 后端把配置落到 settings 键值表，补 get/save 命令 |
| `save_stream_check_config` | `lib/api/connectivity-check.ts:63` | 同上 | 同上 |
| `stream_check_all_providers` | `lib/api/connectivity-check.ts:47` | 只剩单个 `stream_check_provider(appType, providerId)`（已注册） | 后端补批量命令（沿用 v3 的并发探测逻辑），或前端循环调用 |
| `update_toml_common_config_snippet` | `lib/api/config.ts:67` → `components/providers/forms/hooks/useCodexCommonConfig.ts:18` | v3 里是无状态纯文本变换（`config_toml`+`snippet_toml`+`enabled` → 新文本），v4 把服务层函数一并删了；v4 的 `set_common_config_snippet(appType, snippet)` 是写库的另一套模型，**不能替代**（编辑器要对未保存的缓冲区做合并/剥离） | 后端把纯函数命令补回来 |

v3 侧实现位置（移植时的取材处）：
`git show v3.20.4:src-tauri/src/commands/proxy.rs`（成本倍率，含 `*_internal` 分解）、
`.../commands/stream_check.rs`（批量 + get/save config）、
`.../commands/config.rs`（TOML 片段合并）、
`.../database/dao/proxy.rs`（`get_default_cost_multiplier` 在 124 行、`set_` 在 145 行）、
`.../database/dao/stream_check.rs`、
`.../services/provider/live.rs`（`update_toml_common_config_snippet`）。

## 二、返回结构变了（3 条，前端解包即可）

v4 把裸数组包成了「结果 + 失败列表」，字段本身没改名：

| 命令 | v3 返回 | v4 返回 |
| --- | --- | --- |
| `check_skill_updates` | `Vec<SkillUpdateInfo>` | `SkillUpdateCheckResult { updates, failures }`（`services/skill.rs:245`） |
| `discover_available_skills` | `Vec<DiscoverableSkill>` | `SkillDiscoveryResult { skills, failures }`（`services/skill.rs:237`） |
| `install_skills_from_zip` | `Vec<InstalledSkill>` | `ZipInstallResult { installed, skipped }`（`services/skill.rs:264`） |

旧前端 `src-legacy/lib/api/skills.ts:202,207,289` 直接把返回值当数组用，
所以这三条必须在 transport 层解包（`src-legacy` 要求与 v3.20.4 逐字节一致，
不允许就地改）。桌面版和 web 版共用同一个 `web/transport/core.ts` 做适配。

## 三、只是追加了 `Option` 参数（4 条，无需处理）

旧调用不传即为 `None`，行为不变：
`add_provider`（+`editorSave`）、`update_provider`（+`editorSave`）、
`run_tool_lifecycle_action`（+`uninstallPlan`）、`set_proxy_takeover_for_app`（+`stack`,`route`）。

## 四、无头/浏览器下会静默失效的桌面命令

已在命令注册表里、但无头构建走的是空实现或语义变化，旧前端对应功能要降级：

- 托盘：`take_tray_navigation`、`tray_app_page_seen`、`tray_panel_*`（`tray_headless.rs` 全为空操作）
- 深链接：`peek_pending_deeplink` / `ack_pending_deeplink` / `fetch_deeplink_icon`（无头无深链接入口）
- 系统对话框与文件选择：`save_file_dialog` / `open_file_dialog` / `open_zip_file_dialog`，
  以及依赖它们的 `export_config_to_file` / `import_config_from_file` / `install_skills_from_zip`
  → 需要浏览器原生下载/上传桥（限数据目录），任务 #4 处理
- 自动更新：`check_update` 一类（无头不该自更新）
- 打开本地路径 / 终端：`open_config_folder`、`open_provider_terminal`、`reveal_*`
  → 服务器上无 GUI，只能返回路径文本

## 五、【已决策 2026-10-20】默认成本倍率：走法 1（只补命令 + 加说明）

v4 不是「漏了」倍率，而是有意停用：代理侧 `proxy/usage/logger.rs:405` 传 `Decimal::ONE`，
会话用量侧 `session_usage*.rs` 一律 `let multiplier = Decimal::from(1)`，并有专门测试断言旧的
`proxy_config.default_cost_multiplier` 与供应商级 `cost_multiplier` 都不再参与计算
（`proxy/response_processor.rs:1232` `test_log_usage_ignores_legacy_multiplier_and_provider_overrides`）。
v3 旧前端的「定价设置」面板仍然暴露这个输入框。

两条走法里用户选了 **1**：补 `get/set_default_cost_multiplier` 两条命令（DAO 读写 + 校验 + 注册 + 单测），
计费链路一律不动，同时在 UI 上把「v4 不使用倍率」写清楚。落地细节与证据见
`docs/HANDOFF-legacy-web-headless.md` §6.1 / §3.6。

顺带被同一套文案覆盖层修掉的**错误说明**（不报错但会误导）：
供应商表单 `ProviderAdvancedConfig.tsx` 里 `providerAdvanced.costMultiplierHint`
（原文「实际成本 = 基础成本 × 倍率」）与 `providerAdvanced.pricingModelSourceHint`
—— 上游 `src-tauri/src/provider.rs:507-511` 自己把这两个字段注释成「已停用……只为与旧版设备同步时
原样往返保留」，所以 UI 不该宣称它们影响账单。

## 六、已移植部分的实机验证（2026-10-19）

上面第一节 6 条里，除两条倍率命令外，4 条已按 v3 语义移植进 v4 并注册，跑在无头服务上验证通过：

- `update_toml_common_config_snippet`：纯函数走 `toml_edit`，实机
  `model="gpt" + [env] FOO=1` 合并 `[env] BAR=2` → 两段都在、`model` 不动。
  实现位置 `services/provider/live.rs`，命令在 `commands/config.rs`。
- `get_stream_check_config` / `save_stream_check_config`：配置以 JSON 存进 settings 键
  `stream_check_config`（`database/dao/settings.rs`，沿用 `rectifier_config` 的写法）。
  实机存 5/2/3000 后再读回一致。
- `stream_check_all_providers`：与 v3 逐条对齐，含 `proxy_targets_only` 过滤和
  「category=official 不探测」的守卫；`StreamCheckService::check_with_retry` 现在读持久化配置
  （`stream_check_provider` 同样改读持久化配置）。实机对本地 200 端点返回
  `operational/4ms`，对已关闭端口返回 `failed` 且不 500（保留 v3 的 `unwrap_or_else` 兜底）。
  未带回 v3 的 `save_stream_check_log`（v4 无 `stream_check_logs` 写入路径）和
  `model_used` 字段（v4 的 `StreamCheckResult` 已无此字段）。
- 浏览器侧：`node tools/browser-e2e.mjs`（真 headless Chrome + CDP）10/10 通过，
  含「移植命令从页面可达」与「`apply_profile` 后 SSE 真的把 `provider-switched` /
  `profile-applied` 两帧送到浏览器」。

## 七、补录（2026-10-20）：倍率两条命令 + 一处偏离

第一节 6 条**全部**移植完成，累计 6 条命令进 v4 并注册。

- `get_default_cost_multiplier` / `set_default_cost_multiplier`：DAO（`database/dao/proxy.rs:124,145`，
  含 `validate_cost_multiplier`）+ 命令（`commands/proxy.rs:341-400`）+ 注册（`command_handler.rs:240-241`）
  + 单测 `test_default_cost_multiplier_round_trip` / `..._validation`。
  实机 HTTP：`"1"` → 设 `1.5` → `"1.5"`；`-2` / `abc` / `""` 分别报「倍率不能为负数」/
  「无效倍率」/「倍率不能为空」。倍率**不进计费**：把列改回可写之后，上游守卫测试
  `test_log_usage_ignores_legacy_multiplier_and_provider_overrides` 依然绿。
- **一处有意偏离 v3**：`stream_check_all_providers` 里 `db.get_current_provider()` 改为
  `mode::current::provider_for(db, app, Purpose::InUse)`（`commands/stream_check.rs:48`）。
  照抄 v3 会被上游的源码扫描守卫测试 `mode::current::tests::current_provider_is_read_through_provider_for`
  判失败；语义一致（接管中真正跑流量的那家），见 `commands/proxy.rs:538` 的同款写法。
- 浏览器侧新增 6 项断言（供应商表单两行 Hint、倍率命令往返、面板表头文案、面板实际读到库里的 `1.75`、复位），
  `node tools/browser-e2e.mjs` 现在 **16/16**。
- Rust 全量单测（Windows MSVC，`tools/rust.cmd test --lib --features test-hooks`）：
  3761 通过 / 2 失败 → **2026-10-21 复查：两个失败是本机 Windows 系统代理（127.0.0.1:7890）造成的假失败**，
  带上 `NO_PROXY=127.0.0.1,localhost` 后全量 **3763 通过 / 0 失败 / 11 ignored**。
  三组对照与 curl 旁证见 `docs/HANDOFF-legacy-web-headless.md` §3.5 备注。

收尾复跑（2026-10-20，`stream_check.rs:48` 改成 `Purpose::InUse` **之后**）：
- 三道门 `gate1=0 gate2=0 gate3=0`；`test --lib --features test-hooks stream_check` → **13 通过 / 0 失败**
  （含上游守卫测试 `mode::current::tests::current_provider_is_read_through_provider_for`）。
- 重编无头二进制（`--no-default-features --features headless --bin cc-switch-server`）并重启后，
  `node tools/browser-e2e.mjs` **16/16 连跑两次**（25 次 `/api/invoke` 全成功、SSE 两帧到达、无应用级报错）；
  面板表头实测渲染为「默认倍率（v4 计费不使用）」，倍率往返 `"1"` → `1.75` → 复位 `"1"`，
  四个应用（claude/codex/gemini/grokbuild）当前值均为 `"1"`。
- `proxyTargetsOnly` 的过滤语义在新写法下仍然对：带过滤只返回在跑流量的那家，不带返回全部（HTTP 实测，无 500）。

Linux 侧补证（2026-10-21，重编后的 **EL9 原生单二进制**，不套容器）：
- `tools/wsl-el9-native-smoke.sh` 里加了一段倍率命令：`"1"` → 设 `2.5` → 读回 `"2.5"` → `-1` 报
  「无效倍率: -1 - 倍率不能为负数 (Invalid multiplier: -1 - multiplier cannot be negative)」。
  于是 §3.5 那句「6 条移植命令 Windows + Linux 双侧 HTTP 实测通过」现在对**全部 6 条**都成立。
- `tools/wsl-el9-copy-check.sh`（新增守卫）：该二进制内嵌的 `assets/index-0hufZJV7.js` md5
  `36d6ce687c924c223f220fa06fcb8d38` 与本地 `pnpm build:legacy:web` 产物**逐字节一致**，
  且四种语言的「v4 不使用倍率」文案各命中 1 次 —— 部署包不是旧的。
- 构建侧坑：`podman build` 会把 WSL 宿主的 `http_proxy=127.0.0.1:7890` 注进构建步骤，容器里够不着 →
  `pnpm install` 一片 `ECONNREFUSED`。两个构建脚本已加 `--http-proxy=false`（容器直连 registry/crates.io 实测 200）。
- 容器镜像 `localhost/cc-switch-server:dev`（id `03e4b1ffea13`）重编后用 `tools/wsl-el9-container-test.sh`
  重建 `ccs-e2e` 复验：页面 `assets/index-0hufZJV7.js` md5 与本地一致、4 语言文案各命中 1 次、
  倍率 `"1"`→`2.5`→`-1` 报错、SSE 两帧到达、`stream_check_all_providers` 打出 `operational/77ms`。
