# Provider 与路线图

本文说明插件的后端模型、新增后端的步骤，以及计划中多个可选后端必须遵守的规则。

**状态**：目前只实现了 **local** 后端。本文中其他后端、选择字段、凭据、MCP 和 fallback 都是**计划**，尚无代码。

## 1. 当前的接缝

- 插件在 `ctx.web` 只注册**一个** fetch provider（[src/providers/index.ts](../src/providers/index.ts) 的 `createFetchService`），id 由 `providerId` 决定，默认 `http`；
- 这个 provider 不自己抓取，而是把每次请求交给一个**后端**。后端就是一个 `WebFetchProvider` 实例（`id`、`available()`、`fetch(request, signal)`），不是一个 Cordis 插件；
- 选中哪个后端在**每次请求时**决定（`selected()`），今天固定返回 local；
- 后端读取的设置通过 `read()` 在每次请求开始时取一次快照（[src/config.ts](../src/config.ts) 的 `readSettings`）。

这样做的原因：

- `ctx.web` 每次只选一个 fetch provider。插件只占一个席位，切换后端不需要改 Host 组合，也不会碰共享的 `web` 行（见[架构 4.3](architecture.zh-CN.md#43-为什么不碰-web-行)）；
- 上游的 provider 插件（如 `web-fetch-http`、`web-deepseek-api`）的 `apply` 会各自注册 provider。插件只实例化它们导出的类，不调用它们的 `apply`；
- 所有后端共享同一份设置快照、同一个披露检查和同一套上限。

local 后端就是官方 `HttpFetchProvider` 加上本插件的解析器，见[架构](architecture.zh-CN.md)。

## 2. 新增后端的步骤

以一个新后端 `example` 为例。

1. **后端模块**：新建 `src/providers/example/index.ts`，导出 `createExampleProvider(read)`，返回 `WebFetchProvider`。每次 `fetch` 只调用一次 `read()`，之后只用这份快照。后端自己的请求格式、响应格式和映射都留在这个目录里，不进入公共接口。
2. **设置字段**：在 [src/config.ts](../src/config.ts) 中新增该后端的字段，全部是带默认值的可选 `.volatile()` 字段，并加入 `readSettings` 和 `FetchSettings`。缺失时保持原有行为，因此**不需要提升 `schemaVersion`**（见[配置格式版本](configuration.zh-CN.md#配置格式版本)）。密钥不写进配置，只保存凭据引用名（见第 6 节）。
3. **选择字段**：新增一个 volatile 的选择字段（例如 `backend`，默认 `local`），`selected()` 按快照返回对应后端。默认值必须是 local，已有用户升级后行为不变。
4. **`available()`**：必须同步、无副作用：只看后端是否已实现、配置是否有效、所需的服务（如凭据服务）是否存在。不发请求、不解析 DNS、不初始化 MCP、不读取异步凭据、不消耗额度。需要密钥的后端在 `fetch` 时发现缺失，报 `WEB_PROVIDER_CREDENTIAL_MISSING`（上游 DeepSeek provider 就是这样）。组合 provider 报告选中后端的可用性，不再恒为 true；插件被 `web.fetchProvider` 指定时，`available()` 为 false 会报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
5. **披露检查**：远程后端在发出任何请求之前，先执行第 4 节的披露检查。
6. **插件页分区**：在 [settings-page.ts](../src/client/settings-page.ts) 的 `FIELDS` 中加入新字段的转换规则，在 [SettingsPage.tsx](../src/client/SettingsPage.tsx) 中加一个分区，并加入 en / zh 文案。启用远程后端或 fallback 之前，页面要说明 URL 会发给谁、可能产生的费用。浏览器端只能运行时导入平台模块。
7. **测试**：在接缝处测试行为，不测试内部实现：
   - 后端：用本地 HTTP 服务充当远程 API，验证请求格式、到 `WebFetchResult` 的映射、上限和错误码；
   - 披露：被拒绝的 URL 不产生任何对外请求（断言假服务收到 0 个请求）；
   - 出站：在真实安装的代理策略下验证经代理、`NO_PROXY` 直连和取消三种情况（参考 [tests/proxy.spec.ts](../tests/proxy.spec.ts)）；
   - 组合：在 Loader 组合中热修改选择字段，下一次请求即切换后端。
8. **文档**：更新[配置参考](configuration.zh-CN.md)、本文的状态和 [CHANGELOG](../CHANGELOG.md)。

### 结果映射的共同规则

- 远程服务返回的 Markdown 或纯文本映射为 `body: { kind: 'text' }`；只有真正抓到并清洗过的 HTML 才用 `kind: 'html'`；
- 服务自身的 HTTP 状态不是目标页面的状态。服务失败（401、429、5xx、格式错误）是 provider 错误；目标页面的 404 / 403 是正常结果；
- 服务不提供目标状态码或最终 URL 时，使用 `statusCode: 200` 和 `url: request.url`，并在代码中注明这是兼容映射，不代表目标返回了 200（官方 DeepSeek provider 也是这样做的）；
- 插件自己按 `maxBodyChars` 截断时设置 `truncated: true`。服务没有截断信息时，`false` 只表示本插件没有截断，不保证是完整页面。只返回摘录的模式要么标为不完整，要么不用；
- `timeoutMs` 是整个请求的截止时间，包括鉴权、连接、MCP 初始化和读正文；`maxResponseBytes` 尽量在传输层强制，包括 JSON 包装和 SSE。

## 3. 候选后端

以下信息核对于 2026-10-18，来自各服务的公开文档和源码；额度、价格和保留策略以服务方当前文档为准。除 local 外均未实现。

| 后端 | 请求与映射 | 鉴权与匿名额度 | 隐私 | 状态 |
| --- | --- | --- | --- | --- |
| local | 本机直连，官方 `HttpFetchProvider` + 本插件解析器；保留真实状态码和同源最终 URL | 无 | 只有目标站点、DNS 和已配置的代理看到请求 | 已实现 |
| 官方 http | 官方 `HttpFetchProvider`，不注入解析器，只允许公网。local 在白名单为空时已与之等价，单独提供只是为了完全使用上游判定 | 无 | 同上 | 计划 |
| DeepSeek Fetch API | `@deepseek-ai/dsh-web-deepseek-api` 导出的 `DeepSeekFetchApiProvider`；POST `/v1/tools/fetch`，`{ url }` → `{ title, content }` → text，合成 200。该 provider 不限制正文大小，需要插件补上截止时间和字符上限 | **必须**有 DeepSeek 凭据；文档写明每账号 5 次/秒，按次计费 | URL 和内容发给 DeepSeek | 计划 |
| Jina Reader | GET `https://r.jina.ai/<url>`，`Accept: application/json`，`X-Respond-With: markdown`；返回体的 `code/status` 不是目标状态 | 可选 Bearer key；文档写明无 key 20 次/分钟/IP | 默认缓存约 5 分钟；`DNT: 1` 表示不缓存不记录 | 候选 |
| Firecrawl v2 | POST `/v2/scrape`，`{ url, formats: ['markdown'] }`；`data.metadata.statusCode`、`data.metadata.url` 可用 | 可选 Bearer key；免 key 每月 1000 credits，按 IP 限流 | 可能缓存；免 key 模式不承诺零保留 | 候选 |
| Exa（托管 MCP） | `tools/call` `web_fetch_exa`，`{ urls: [url], maxCharacters }`；默认每页 3000 字符，需显式设置上限并保守标记截断；无状态码 | 匿名限流，可选 key（用 header，不要放在 URL） | URL 和 MCP 元数据发给 Exa | 候选 |
| Parallel（托管 MCP） | `tools/call` `web_fetch`，`{ urls: [url], full_content: true }`；默认只返回摘录，不能当作完整页面；响应格式需真实样本后再实现 | `/mcp` 匿名，可选 Bearer key 提高额度 | URL 及可选的 objective 发给 Parallel | 候选 |
| Tavily extract | POST `https://api.tavily.com/extract`，`{ urls, format: 'markdown', extract_depth: 'basic' }`；线上字段是 `results[].raw_content` 和 `failed_results`；无状态码 | 不带 key 且未设置 `TAVILY_API_KEY` 时为匿名模式；额度未公布 | URL 和内容发给 Tavily | 候选，见第 5 节 |
| markdown.new | POST `https://markdown.new/`，`{ url, method: 'auto', retain_images: false }` → JSON `{ success, content, … }`；大页面可能无标记截断 | 无需注册；文档写明 500 次/天/IP | 记录 URL 和 IP；响应缓存 300 秒 | 候选 |
| defuddle.md | GET `https://defuddle.md/<url>` → 带 YAML 头的 Markdown | 可选付费 key；条款写明 1000 次/月/IP | 内容缓存不超过 24 小时；记录请求 URL | 候选 |

来源：[DeepSeek Fetch API](https://api-docs.deepseek.com/api/fetch/)、[DeepSeek 搜索与抓取指南](https://api-docs.deepseek.com/guides/search/)、[Jina Reader](https://jina.ai/reader/)、[Firecrawl scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape)、[Firecrawl 免 key 说明](https://www.firecrawl.dev/blog/firecrawl-keyless-launch)、[Exa MCP server](https://github.com/exa-labs/exa-mcp-server)、[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp.md)、[Tavily JS](https://github.com/tavily-ai/tavily-js)、[markdown.new](https://markdown.new/)、[defuddle.md](https://defuddle.md/docs)。

## 4. 披露策略（强制）

本地白名单授权的是“本机可以连到这些地址”，**不是**“可以把这些 URL 告诉第三方”。任何远程后端，包括官方 DeepSeek Fetch API，都必须在发出请求之前执行下面的检查；检查放在 `fetch` 中，不放在 `available()` 中。

1. 按现有规则解析 URL（http(s)、长度上限、无 URL 凭据），去掉片段；
2. 主机是非公网 IP 字面量（包括 IPv4 映射、IPv4 兼容和 NAT64 形式）、`localhost`、单段名称或保留的本地后缀时，直接拒绝，不解析 DNS；
3. 普通域名在同一截止时间内用系统 DNS 解析，检查**全部**答案。只要有一个已知的非公网答案就不发出，即使本地白名单允许它；
4. **Fake-IP**：`198.18.0.0/15` 是基准测试网段，Clash 会把它分配给完全公开的域名。这个网段和“请求会走代理”都不能证明域名是公网的。默认对这类域名只走 local 或报 `WEB_BLOCKED_URL`，也绝不把 Fake-IP 地址本身发给远程服务；
5. 确实需要在 Fake-IP DNS 后面使用远程后端时，提供一个单独命名的 operator 声明，例如 `remotePublicHostnames`：列出已知公开的域名，只在 DNS 不透明（Fake-IP）时允许披露这些名字。它不放行私网字面量或真实的 RFC 1918 / ULA 答案，也与 `allowCidrs`、`allowHostnames` 无关。精确域名比后缀更安全；
6. DNS 失败、公私混合答案或无法分类时，不自动披露。名字看起来公开的内网域名无法可靠识别，文档和页面要说明这一限制，由 operator 显式声明，而不是默认所有带点的名字都安全。不要用外部 DNS-over-HTTPS 来判断，那本身就会泄露内网域名。

拒绝必须发生在构造 Jina 的 URL 前缀、序列化 MCP 参数、调用任何 SDK 以及进入 fallback 之前。官方 HTTP provider 对走代理的域名跳过本地 DNS，这是传输层的处理，不能当作远程披露的分类规则。

## 5. 出站规则

- DSH 的启动器在插件加载前安装全局代理策略。Host 端的全局 `fetch` 以及基于它的 SDK 自动继承这一策略。远程后端一律使用全局 `fetch`；
- 不要自己构造 Undici 的 `Agent`、`ProxyAgent` 或 `EnvHttpProxyAgent`，不要传 `dispatcher`，不要重新安装策略或自行解析 `HTTP_PROXY` 等环境变量。上游仓库用 `verify-no-bare-dispatcher` 检查这一点，本插件遵守同样的约定；
- 只有需要显式路由决定的 SDK 才使用 `proxyRouteFor(new URL(endpoint))`：有自己代理选项的 SDK 传 `route.proxy`；返回的 dispatcher 属于策略，调用方不能关闭它；
- 远程 API 请求设置 `redirect: 'error'`，并把请求的 `signal` 与整体截止时间合并；
- `NO_PROXY` 绕过只表示直连，不表示目标被授权；
- **Tavily SDK 例外**：官方 JS SDK 使用 Axios 和 https-proxy-agent，不走全局 `fetch`；没有 fetch、dispatcher 或 AbortSignal 钩子；传入空 `apiKey` 也挡不住环境变量 `TAVILY_API_KEY`。因此不使用该 SDK，直接用全局 `fetch` 实现匿名 POST；不修改 `process.env`，不全局修补 Axios；
- 每个新的出站点都要有传输层测试，证明经代理、直连和取消的行为。

## 6. 凭据

**Host 端**：

- 配置中只保存凭据引用名（如 `DEEPSEEK_API_KEY`、`JINA_API_KEY`），从不保存密钥本身；
- 每次请求用 `credentialRef(name)` 和 `ctx.get('credentials')?.resolve(ref)` 解析一次，不跨请求缓存；解析与请求的 signal 竞速；
- 凭据服务存在但返回空时，不再回退读环境变量，由该服务决定；只有服务不存在时才用 `launchEnvironmentOf(ctx)` 读取启动环境；
- 可选 key 的后端缺 key 时匿名请求；必需 key 的后端报 `WEB_PROVIDER_CREDENTIAL_MISSING`。

**浏览器端**：

- 用平台导出的 `SettingsSecretField` 渲染密钥输入，草稿只存在页面状态中；
- 通过注入的 `ctx.remote.credentials` 操作：`describe([ref])` 查询是否已配置、是否可写；显式保存且草稿非空时调用 `set(ref, draft)`，再 `describe` 确认后清空草稿。空草稿表示保持原值，不表示删除；
- 订阅 `credentials/reference-updated`，只重新查询关注的引用；丢弃过期的 `describe` 响应；
- 浏览器不能读取密钥。`credentialRef`、`launchEnvironmentOf` 等 Host 模块不在壳的模块表中，浏览器代码不能运行时导入，只能用类型导入或结构化接口；客户端的 `inject` 需要加入 `remote` 相关服务。

## 7. MCP 后端

DSH 的 `dsh-mcp-client` 不导出独立的连接 API；它的 `apply` 会连接服务器并把远程工具注册给模型，不适合作为隐藏的后端。计划做法：

- 直接依赖与 DSH 相同的 `@modelcontextprotocol/client`（当前 2.2.0），不导入 DSH 内部模块，也不自己手写 initialize、会话头和 SSE 解析；
- 每次请求新建一个 `Client` 和 `StreamableHTTPClientTransport`，请求头设置 `redirect: 'error'`，用 `finally` 关闭；连接池是以后的优化；
- `connect` 和 `callTool` 使用同一个整体截止时间和 signal，而不是每个往返各自计时。SDK 中 signal 取消和超时都可能表现为 `REQUEST_TIMEOUT`，要根据调用方的 signal 和截止时间区分 `WEB_ABORTED` 与 `WEB_FETCH_TIMEOUT`；
- 自己校验 `result.isError`、结构化内容、文本块和逐 URL 的错误，不把错误文本当作页面内容返回；
- 不把远程 MCP 服务器的工具或提示暴露给模型。

## 8. Fallback 策略

默认**没有** fallback。启用时：

- 只使用 operator 显式配置的有序后端列表；共享同一个整体截止时间和输出上限；不做重试循环；
- 对每个远程后端重新执行披露检查；启用前在页面说明新的披露对象和费用；
- 返回最后一个有用的错误，并附带不含密钥的简短尝试记录。

| 错误 | 是否可以 fallback |
| --- | --- |
| `WEB_FETCH_TIMEOUT`（单次尝试超时，且整体时间还有剩余） | 可以 |
| `WEB_PROVIDER_ERROR`，且确认是暂时性传输错误、429 或 5xx | 可以；需要内部的可重试标记，仅凭错误码不够，因为它也覆盖格式和配置错误 |
| `WEB_PROVIDER_UNAVAILABLE`、`WEB_PROVIDER_CONFIGURED_UNAVAILABLE`、`WEB_PROVIDER_CREDENTIAL_MISSING` | 仅在显式开启“预检跳过”时可以；默认不隐藏缺少必需凭据的配置错误 |
| `WEB_ABORTED`、`WEB_BLOCKED_URL`、`WEB_INVALID_URL`、`WEB_REDIRECT_BLOCKED`、权限拒绝、配置 / 重复 / 歧义注册错误 | 绝不 |
| 目标返回的 404、403 等 | 不是错误，是正常结果，不触发 fallback |

远程后端不能用来绕过本地的拦截、大小限制或其他安全策略。operator 可以为另一次请求选择另一个后端。
