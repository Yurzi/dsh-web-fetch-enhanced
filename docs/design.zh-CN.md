# 设计文档

## 1. 目标

本插件只解决一个问题：在 DeepSeek Harness 的 HTTP fetch provider 中，为非公网地址过滤增加显式、可审计的 CIDR 白名单，同时维持原生 <code>web_fetch</code> 的工具名称、参数、结果与安全约束。

设计目标：

1. 空白名单与原生 public-only 策略等价；
2. fake-IP 等保留地址路由可以按 CIDR 放行；
3. 可用域名规则作为第二因子缩小例外范围；
4. DNS 校验结果必须直接用于连接，避免 rebinding/TOCTOU；
5. provider 可与原生实现共存，也可在 composition 中做 drop-in 替换；
6. 不改变模型侧 <code>web_fetch</code> schema 和结果呈现。

非目标：

- 不读取或注入 cookie、Authorization、客户端证书；
- 不允许模型设置任意 header、HTTP method 或代理地址；
- 不加载图片、脚本、CSS 等子资源；
- 不支持跨源自动重定向；
- 不把白名单配置暴露成模型参数；
- 不提供 provider fallback 或优先级链；
- 不修改 agent preset 权限边界。

## 2. Cordis 与 DSH 接入面

DeepSeek Harness 的 <code>@deepseek-ai/dsh-web</code> 提供 <code>ctx.web</code> 服务和 fetch provider 注册表。模型侧 <code>@deepseek-ai/dsh-tool-web</code> 只调用 <code>ctx.web.fetch()</code>，因此替换 provider 不会改变工具接口。

~~~mermaid
flowchart LR
  M[Model] --> T[web_fetch / dsh-tool-web]
  T --> W[ctx.web / dsh-web]
  W -->|fetchProvider: http-enhanced| P[dsh-web-fetch-enhanced]
  P --> D[resolve all DNS answers]
  D --> A[address and hostname policy]
  A --> U[pinned Undici dispatcher]
  U --> R[bounded text response]
~~~

本插件是 Host 侧 provider：它消费已有的 <code>web</code> 服务并注册一个 fetch provider，但不发布新的 Cordis 服务。因此它属于 Host composition，不属于 agent preset。模型工具仍由 preset 中原有的 <code>tool-web</code> 行提供。

入口采用 namespace plugin 约定，只命名导出 <code>name</code>、<code>inject</code>、<code>Config</code>、安全的 <code>createProvider</code> 和 <code>apply</code>，没有 default export，也不公开低级 pinned transport/custom resolver helper。与 DeepSeek Harness 内部 Host 插件一致，源码使用显式 <code>.ts</code> 相对导入，<code>cordis.source.patch.yml</code> 在开发时直接加载源码；发布构建由 TypeScript 生成 <code>lib/types</code>，再由 tsdown 输出 Host ESM。随包发布的 <code>cordis.patch.yml</code> 供操作者显式合并到 Profile composition。

## 3. Provider 选择

<code>ctx.web</code> 的选择是 ID 驱动而不是注册顺序驱动：

- 配置 <code>fetchProvider: http-enhanced</code> 时只选择本插件默认 ID；
- 保留原生 <code>http</code> provider 不会产生歧义，因为选择已显式固定；
- 未配置 ID 且存在多个可用 provider 时会报 <code>WEB_PROVIDER_AMBIGUOUS</code>；
- 两个 provider 注册相同 ID 会立即报 <code>WEB_DUPLICATE_PROVIDER</code>。

所以“覆盖原生”有两种明确模式：

1. 推荐模式：本插件使用 <code>http-enhanced</code>，修改现有 web 行的 <code>fetchProvider</code>；
2. drop-in 模式：禁用原生 provider，本插件配置 <code>providerId: http</code>。

不存在 last-wins 或自动 fallback。

## 4. 请求数据流

一次 fetch 的顺序如下：

1. 检查 URL 长度不超过 2048；
2. 由 WHATWG URL 解析，仅接受 HTTP(S)，拒绝 URL 内嵌凭据；
3. 对域名执行一次 <code>lookup(all: true, order: verbatim)</code>；IP literal 直接进入相同策略；
4. 验证每个答案的 family 与文本格式；
5. 逐个判断公网单播或白名单例外；任何一个失败就拒绝整个答案集；
6. 若存在 IPv6，解析 <code>ipv4only.arpa</code> 发现活动 DNS64 前缀，并检查嵌入的 IPv4；
7. 为当前请求创建私有 Undici Agent，其 lookup 回调只返回已验证答案；
8. 保持原始 URL hostname，用于 Host header 与 TLS SNI；
9. 手动处理响应；同源重定向回到步骤 1，每一跳重新解析和固定；
10. 验证 MIME 与 charset，按字节和字符上限读取；
11. 返回 <code>WebFetchResult</code>，非 2xx 状态不转为异常。

## 5. 白名单语义

### 5.1 地址条件

<code>allowCidrs</code> 只对非公网地址生效。公网单播地址始终允许，不会因为未命中白名单而被拒绝。

非公网地址必须命中至少一个 CIDR。IPv4-mapped 和废弃的 IPv4-compatible IPv6 会先转换为嵌入的 IPv4，再执行分类与 CIDR 匹配；配置中拒绝 IPv4-mapped CIDR，要求直接写对应 IPv4 CIDR。IPv4 CIDR 只接受四段十进制，IPv6 拒绝 zone ID，且所有 CIDR 必须填写规范的网络基址，避免审计语义歧义。

### 5.2 域名第二因子

<code>allowHostnames</code> 为空时，命中 CIDR 就足以使用例外。非空时，非公网地址还必须命中一个域名规则：

- <code>api.example.com</code> 为精确匹配；
- <code>*.example.com</code> 匹配其子域名，不匹配根域名；
- 只允许最左侧完整标签通配符；
- 规则不得包含端口、反斜杠、路径、查询、片段或凭据分隔符；
- 域名按 URL 规则规范化、转小写并移除末尾点。

域名规则不是 DNS 信任替代物；它只是 operator 配置的第二个静态条件。

### 5.3 NAT64

活动 DNS64 前缀通过 RFC 7050 保留名发现。若 IPv6 答案映射到一个非公网 IPv4，则嵌入的 IPv4 也必须满足同一白名单和域名条件。一个地址同时匹配多个重叠 Pref64 时会验证所有候选，而不是依赖 DNS 返回顺序；这避免内核最长前缀路由与策略选择不一致。

## 6. 配置与生命周期

Cordis Config schema 提供所有默认值；<code>createProvider()</code> 也在直接调用时应用同一默认值。启动阶段校验：

- provider ID 字符集和长度；
- CIDR 与域名规则语法；
- 字节、字符与超时必须为正有限数；
- 超时不能超过 Node timer 上限；
- redirect 上限必须为非负整数。

<code>ctx.web.registerFetchProvider()</code> 返回的注册由 web 服务绑定到当前 Cordis Fiber，插件停止、更新或 HMR 时会自动注销，没有进程级残留。

## 7. 错误契约

插件沿用 DSH 的 <code>WebError</code>：

| code | 含义 |
| --- | --- |
| <code>WEB_INVALID_URL</code> | URL 无效、scheme 不支持或超长 |
| <code>WEB_BLOCKED_URL</code> | 凭据、非公网且未白名单、NAT64 目标未白名单 |
| <code>WEB_REDIRECT_BLOCKED</code> | 跨源、缺少预算或不安全 redirect |
| <code>WEB_FETCH_TOO_LARGE</code> | 声明响应长度超过上限 |
| <code>WEB_FETCH_TIMEOUT</code> | provider 自身资源超时 |
| <code>WEB_UNSUPPORTED_CONTENT_TYPE</code> | 二进制 MIME 或不支持的 charset |
| <code>WEB_ABORTED</code> | 调用方或外层工具策略取消 |
| <code>WEB_PROVIDER_ERROR</code> | DNS、连接、TLS、流读取等 transport 故障 |

模型侧工具的 timeout policy 可能把外层截止时间呈现为 <code>TOOL_TIMEOUT</code>；这是 DSH 已有的两层超时设计。

## 8. 兼容策略

插件只依赖 <code>@deepseek-ai/dsh-web</code> 和 <code>@deepseek-ai/dsh-timeout</code> 的公开包根 API，不依赖 DSH 包的 <code>src/*</code> 深路径。安全 transport 在本包内维护，相关行为通过契约测试固定。

版本升级时重点回归：

- <code>WebFetchProvider</code> 与 <code>WebFetchResult</code> 类型；
- <code>WebError</code> 构造参数；
- deadline/timeout 分类；
- Cordis namespace plugin 的无 default export 约束；
- DSH 原生 provider 的安全策略变化。
