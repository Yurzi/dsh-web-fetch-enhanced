# Changelog

本文件记录 dsh-web-fetch-enhanced 的版本变化，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。0.0.x 期间的版本均可能包含不兼容变化。

## [0.1.0] - 2026-10-19

### 破坏性变化

- 最低支持 DSH 提升到 **0.2.1-rc.2**，`engines.dsh` 为 `>=0.2.1-rc.2 <0.3.0-0`。不再支持 0.2.0-rc.2，仍在该版本的用户请使用 0.0.12。
- 默认 `providerId` 由 `http-enhanced` 改为 **`http`**，插件以 drop-in 方式占据原生 provider 的位置。
- bundle patch **不再改写共享的 `web` 行**，只禁用 `web-fetch-http` 并插入插件行。
- 给模型的白名单说明由系统提示词 section 改为运行时上下文。preset 设置 `includeRuntimeContext: false` 时不再出现。
- 移除公开导出 `formatAllowlistPrompt`、`isNonPublicIpLiteral`、`defaultProxyRoute`、`SETTINGS_NAMESPACE`、`DEFAULT_USER_AGENT`（改从 `@deepseek-ai/dsh-web-fetch-http` 导入），以及类型 `ProviderConfig`、`ProxyRouteResolver`、`ProxyRouteResult`。`createProvider` 只接受一个原始配置参数。当前公开导出：`name`、`inject`、`Config`、`apply`、`createProvider`、`CONFIG_SCHEMA_VERSION`、`migrateConfig`、`DEFAULT_PROVIDER_ID` 和类型 `FetchSettings`。
- 数值字段只接受整数。

### 新增

- 插件页按平台组件重做：一个“保存”写入全部字段，单次带 revision 的写入；每个字段有“已自定义”标记和“重置”；“限制”折叠区可编辑超时、字节、字符和重定向四个上限。
- 白名单逐行检查，与 Host 共用同一语法模块：错误行阻止保存并提供一键修正（主机位改为网络地址、URL 改为域名等）；元数据地址、回环、过宽网段和公网网段给出不阻止保存的警告；检测重复行。
- 一键加入“Clash / Mihomo Fake-IP” `198.18.0.0/15`。
- 路由提示：`web_fetch` 改由 DeepSeek Fetch API 提供（官方开关已打开），或 `web` 行未指定 fetch provider 时，插件页给出说明。
- 插件页只在 Host 运行插件行时注册。
- 插件页显示的标题、描述和图标（`locale/*.json`、`assets/icon.svg`）。
- provider 后端模型：插件只占 `ctx.web` 的一个席位，按请求委托给后端，为后续可选后端做准备，见 [Provider 与路线图](docs/providers.zh-CN.md)。
- 端到端测试 `pnpm run test:e2e`：在隔离环境中安装被测版本的 DSH，用插件管理器装入打包产物，真实启动 Host 与 DSH Web 验证组合、抓取和设置页，见 [端到端测试](docs/e2e.zh-CN.md)。

### 变更

- 传输层改为运行时直接使用官方 `@deepseek-ai/dsh-web-fetch-http` 的 `HttpFetchProvider`（URL 规则、重定向、代理路由、连接固定、超时、大小上限、MIME / charset），只注入本插件的白名单解析器。插件不再维护传输层副本，`undici`、`@deepseek-ai/dsh-timeout`、`@deepseek-ai/dsh-http-proxy` 不再是运行时依赖。
- 运行时上下文只在配置了 CIDR，且 `web` 行的 `fetchProvider`（或 `DSH_WEB_FETCH_PROVIDER`）选中本插件时出现；无法判断组合时视为选中。
- 域名规则拒绝 IPv6 区域标识和 URL 无法表示的 IPv6 写法。
- 开发流程改为 `pnpm dev` 加 `dsh plugin --profile <p> add link:<绝对路径>`，依靠 DSH 0.2.1 的 HMR 替换插件；单一 tsconfig，tsdown 构建，type-aware oxlint，vitest，publint。CI 覆盖 Node 22.19.0 和 24；发布前检查 tag 与包版本一致。
- 文档重新组织为 README、[配置参考](docs/configuration.zh-CN.md)、[架构](docs/architecture.zh-CN.md)、[安全设计](docs/security.zh-CN.md)、[Provider 与路线图](docs/providers.zh-CN.md) 和本文件。

### 修复

- 修复 DSH 0.2.1 上 `web_search` 报 `WEB_PROVIDER_AMBIGUOUS`。0.0.12 的 bundle patch 把 `web.config` 整体替换为只含 `fetchProvider`，丢掉了 `searchProvider`；0.2.1 的 base 默认挂载始终可用的 DeepSeek Search / Fetch API provider，自动选择因此失败。已在真实的 0.2.1-rc.2 组合上验证。
- 官方“启用新版 Web 搜索 API”开关现在可以正常切换：打开时 `web_fetch` 使用 `deepseek-fetch-api`，关闭后回到 `http`，即本插件。此前关闭开关会指向已停用的原生 provider，报 `WEB_PROVIDER_CONFIGURED_MISSING`。
- 白名单外的非公网 IP 字面量在交给官方 transport 之前就被拒绝。官方 transport 会把它判定为公网的 IP 字面量直接交给已配置的出站代理，不经过解析器，而 IPv4 兼容的 IPv6（如 `[::7f00:1]`）会被判定为公网；配置了代理时，这类地址可能经代理到达本机服务。
- 运行时上下文能在 Profile 的 include 子树中找到 `web` 行，正确判断本插件是否在服务 `web_fetch`。
- IPv6 回环地址 `::1` 现在能被 `::1/128` 放行。此前它被当作 IPv4 兼容地址 `0.0.0.1` 判断，任何规则都放行不了；在 `localhost` 解析出 `::1` 的系统上，放行本机服务因此失败。

### 移除

- `cordis.source.patch.yml`、`examples/drop-in.cordis.yml`、`examples/manual.cordis.patch.yml`。默认安装就是 drop-in；源码开发改用 `link:` 安装。
- `docs/design.zh-CN.md`、`docs/config-versioning.zh-CN.md`、`docs/migration-0.1.7-rc.1.zh-CN.md`、`docs/releases/`，内容并入新文档和本文件。

### 升级步骤

1. 先把 DSH 升级到 0.2.1-rc.2 或范围内的更新版本。备份 Profile 的 `cordis.patch.yml`。
2. 升级插件：在插件页点“更新”，或执行 `dsh plugin --profile web remove dsh-web-fetch-enhanced`，再 `dsh plugin --profile web add dsh-web-fetch-enhanced@0.1.0`。HMR 下直接 `add` 已安装的包会返回 `already-installed`。
3. 检查 Profile 中的旧覆盖：
   - `web` 行的 `fetchProvider: http-enhanced`（只有手动写过才会有）现在会报 `WEB_PROVIDER_CONFIGURED_MISSING`。删掉它，或者把插件行的 `providerId` 也设为 `http-enhanced`（共存模式，见 [examples/coexist.cordis.yml](examples/coexist.cordis.yml)）；
   - 插件行显式写了 `providerId: http-enhanced` 时，原生行已停用、`web.fetchProvider` 仍是 `http`，同样会报 `WEB_PROVIDER_CONFIGURED_MISSING`。删掉这项，或按共存模式配置；
   - 照旧示例写过只含一个字段的 `web` 行 patch 时，删掉它，或把 `searchProvider` 和 `fetchProvider` 都写全。
4. 用 `dsh --profile web --dump-config` 确认：`web-fetch-http` 为 `disabled: true`，`web` 行同时有两个字段。分别调用一次 `web_search` 和 `web_fetch`，确认没有 `WEB_PROVIDER_AMBIGUOUS`。
5. 白名单、User-Agent 和上限的已有配置继续有效，`schemaVersion` 仍为 `1`。上限字段中的非整数值会被拒绝，需要改为整数。
6. preset 设置了 `includeRuntimeContext: false` 时，模型不再收到白名单说明；需要时在该 preset 中重新开启运行时上下文。
7. 程序化使用者改用新的公开导出；`DEFAULT_USER_AGENT` 从 `@deepseek-ai/dsh-web-fetch-http` 导入。

## [0.0.12] - 2026-10-10

### 新增

- 插件页增加 User-Agent 编辑区，可保存、放弃和重置为继承值。
- 默认 User-Agent 改为与官方一致的 `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)`；已有的显式覆盖（包括空字符串）保持不变。

### 修复

- 浏览器与 Host 共用请求头字符校验，拒绝 CR/LF、其他控制字符和非 Latin-1 字符，包括末尾换行。

## [0.0.11] - 2026-10-04

### 新增

- 插件配置格式版本 `schemaVersion`，当前为 1。无版本配置按 v0 在内存中迁移到 v1，不改写文件。
- 非法版本和高于支持范围的版本直接报错，不降级。迁移保留未知字段和显式空数组。

## [0.0.10] - 2026-09-30

### 变更

- 最低支持 DSH 0.2.0-rc.2，`engines.dsh` 与 DSH peers 为 `>=0.2.0-rc.2 <0.3.0-0`。上游公开接口兼容，无需迁移配置。
- 升级需要先移除再安装插件。

## [0.0.9] - 2026-09-29

### 变更

- 最低支持 DSH 0.2.0-rc.1，范围 `>=0.2.0-rc.1 <0.3.0-0`，上界排除 0.3.0 预发布版。不再支持 0.1.x。

### 修复

- 浏览器端产物改为 `.cjs` 扩展名，消除 ESM 包中 CJS 产物的格式警告；保留 ModuleLoader factory 契约。

## [0.0.8] - 2026-09-25

### 变更

- 最低支持 DSH 0.1.7-rc.2，范围 `>=0.1.7-rc.2 <0.2.0`。上游变化不涉及本插件使用的接口，无需修改代码或配置。

## [0.0.7] - 2026-09-24

### 变更

- 最低支持 DSH 0.1.7-rc.1。配置改为当前 Profile 的 Cordis Config 与 volatile 字段，不再读取全局 `settings.yaml`；旧的全局白名单需要人工审查后迁入 Profile。
- 白名单表单直接显示在插件详情页。清空保存为显式 `[]`，只有“恢复继承”才移除覆盖。

### 修复

- 修复配置 schema 的校验回调在传输中被去掉、导致输入框一直禁用的问题；Host 仍完整校验。
- 保存使用 revision 拒绝过期写入，外部变更不覆盖正在编辑的草稿。

## [0.0.6] - 2026-09-11

### 变更

- 设置按需写入：只保存与默认值不同的字段，保存时清理旧版本留下的冗余空数组。

## [0.0.5] - 2026-09-11

### 新增

- 配置了非公网白名单时，向系统提示词加入授权说明，减少模型对内网 URL 的拒答。

### 变更

- 最低支持 DSH 0.1.5-rc.2，开始声明 `engines.dsh`；直接使用官方代理路由类型。

## [0.0.4] - 2026-09-04

### 新增

- 支持 DSH 全局出站代理（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`）；非公网 IP 字面量不走代理。

### 变更

- 最低支持 DSH 0.1.2-rc.1，开始只支持 RC 和正式版。

## [0.0.3] - 2026-09-02

### 变更

- bundle patch 禁用原生 `web-fetch-http`，`web` 行 patch 只写 `fetchProvider: http-enhanced`。这次改动丢掉了 `searchProvider`，是 0.1.0 修复的 `WEB_PROVIDER_AMBIGUOUS` 的起因。

## [0.0.2] - 2026-08-31

### 变更

- 适配 DSH 0.1.2-alpha.2 的设置接口，设置项标题改为 “Web Fetch Enhanced”。

## [0.0.1] - 2026-08-28

### 新增

- 首个版本：`http-enhanced` fetch provider，CIDR 白名单和可选的域名第二因子。
- DNS 全答案集校验与连接固定、IPv4 映射地址与 DNS64 / NAT64 检查、只跟随同源重定向、匿名 GET 与资源上限。
- DSH Web 设置中的白名单编辑界面。

[0.1.0]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.12...v0.1.0
[0.0.12]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.5...v0.0.7
[0.0.6]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.5...d6390ea
[0.0.5]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.2...v0.0.5
[0.0.4]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.2...41fb428
[0.0.3]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.2...58b7882
[0.0.2]: https://github.com/Yurzi/dsh-web-fetch-enhanced/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/Yurzi/dsh-web-fetch-enhanced/releases/tag/v0.0.1
