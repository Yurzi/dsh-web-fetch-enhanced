# 架构

本文描述 0.1.x 的实现：模块划分、一次请求的数据流、插件如何接入 Host 组合、配置的生命周期、模型提示、浏览器端和错误契约。配置字段见[配置参考](configuration.zh-CN.md)，安全分析见[安全设计](security.zh-CN.md)，后端扩展见 [Provider 与路线图](providers.zh-CN.md)。

## 1. 目标与边界

目标：

1. 不配置例外时，与原生 `web_fetch` 的 public-only 策略等价；
2. operator 可以按 CIDR 放行非公网地址，并可用域名规则缩小范围；
3. 模型侧工具名、参数和结果不变；
4. 传输层不自己实现，直接复用官方 `@deepseek-ai/dsh-web-fetch-http`；
5. 不改写共享的 `web` 行，与其他 Web 插件和官方开关互不破坏。

不做的事：不发送 cookie、Authorization 或客户端证书；不让模型设置 header、method、代理或白名单；不跟随跨源重定向；不加载子资源；默认没有 fallback 链；不修改 agent preset 的权限。

## 2. 模块地图

| 文件 | 职责 | 运行于 |
| --- | --- | --- |
| [src/index.ts](../src/index.ts) | 入口：`name`、`inject: ['web']`、`apply`、`createProvider(raw)` 和公开导出 | Host |
| [src/contract.ts](../src/contract.ts) | 两端共用的名称和值规则：包名、行 id `web-fetch-enhanced`、默认 provider id `http`、provider id 正则、计时器上限、User-Agent 字符规则。不导入任何 Node 或 Host 包 | Host、浏览器 |
| [src/config.ts](../src/config.ts) | Config schema、`hostChecked`、每次请求的快照 `readSettings` | Host |
| [src/config-migrations.ts](../src/config-migrations.ts) | `CONFIG_SCHEMA_VERSION`、`migrateConfig`、`withConfigMigrations` | Host |
| [src/prompt.ts](../src/prompt.ts) | 给模型的运行时上下文及其生效条件 | Host |
| [src/providers/index.ts](../src/providers/index.ts) | `createFetchService`：插件在 `ctx.web` 的唯一席位，按请求委托给选中的后端 | Host |
| [src/providers/local/index.ts](../src/providers/local/index.ts) | local 后端：每次请求构造 `AddressPolicy`，先检查 URL 中的 IP 字面量，再构造官方 `HttpFetchProvider` 并注入本插件的解析器 | Host |
| [src/providers/local/rules.ts](../src/providers/local/rules.ts) | 白名单语法：`parseCidr`、`parseHostnameRule`、`cidrWarnings`、`matchesCidr`、`normalizeHost`。只依赖 ipaddr.js 和 WHATWG URL | Host、浏览器 |
| [src/providers/local/address-policy.ts](../src/providers/local/address-policy.ts) | `AddressPolicy.allows(hostname, address)` 与 `isPublicAddress`；非法规则抛出带字段名的错误 | Host |
| [src/providers/local/resolver.ts](../src/providers/local/resolver.ts) | `resolveAllowedAddresses`：一次解析、全集校验、NAT64、随请求取消 | Host |
| [src/client/index.ts](../src/client/index.ts) | 浏览器入口：词典、样式、控制器、slot 注册 | 浏览器 |
| [src/client/settings-page.ts](../src/client/settings-page.ts) | `SettingsPageController`：草稿、保存计划、revision、路由提示 | 浏览器 |
| [src/client/SettingsPage.tsx](../src/client/SettingsPage.tsx) | 页面渲染 | 浏览器 |
| [src/client/allowlist-lines.ts](../src/client/allowlist-lines.ts) | 白名单文本框的逐行解读：错误、重复、警告、修正 | 浏览器 |
| [src/client/locales.ts](../src/client/locales.ts) | 页面文案（en / zh） | 浏览器 |
| [src/client/style.css](../src/client/style.css) | 页面样式，类名统一以 `wfe-` 开头 | 浏览器 |
| [locale/](../locale/)、[assets/icon.svg](../assets/icon.svg) | 插件页显示的标题、描述和图标 | 插件页 |
| [cordis.patch.yml](../cordis.patch.yml) | bundle patch：禁用原生行，插入插件行 | Profile |

构建产物：`lib/index.js` 和 `lib/index.d.ts`（Host ESM），`lib/client.cjs`（浏览器端，见第 7 节）。

## 3. 请求数据流

~~~mermaid
flowchart TD
  M[模型调用 web_fetch] --> W["ctx.web.fetch()"]
  W -->|"web.fetchProvider 或 DSH_WEB_FETCH_PROVIDER 选中 http"| S["插件 provider<br/>providers/index.ts"]
  S --> L["local 后端：读取一次配置快照"]
  L --> LIT{"URL 主机是 IP 字面量?"}
  LIT -->|"白名单外的非公网地址"| E
  LIT -->|"否，或已允许"| HP["new HttpFetchProvider(settings, resolver)"]
  HP --> U["URL 检查：http(s)、长度 ≤ 2048、无 URL 凭据"]
  U --> P{"proxyRouteFor(url)"}
  P -->|"走代理，且不是非公网 IP 字面量"| X[交给代理，由代理解析]
  P -->|直连| D["resolveAllowedAddresses<br/>完整答案集 + NAT64 + AddressPolicy"]
  D -->|任一答案不合规| E[WEB_BLOCKED_URL]
  D -->|全部合规| C["连接固定到已验证地址<br/>Host 头和 TLS SNI 保持原域名"]
  X --> H{重定向?}
  C --> H
  H -->|同源且未超跳数| U
  H -->|跨源或超跳数| R[WEB_REDIRECT_BLOCKED]
  H -->|否| BODY["读正文：字节上限、MIME、charset、字符上限"]
  BODY --> OUT[WebFetchResult]
~~~

除 IP 字面量检查和 `resolveAllowedAddresses` 外，图中每一步都是官方 `HttpFetchProvider` 的代码。官方 provider 自带的解析器只接受公网地址；本插件通过构造参数注入自己的解析器，只放宽这一处判断。每一跳重定向都会再次调用解析器。

IP 字面量检查是为了补上官方 transport 的一个缺口：它把判定为公网的 IP 字面量直接交给已配置的代理，不调用解析器，而它的判定把 IPv4 兼容的 IPv6（如 `[::7f00:1]`）当作公网。插件因此在委托之前用自己的地址策略检查字面量。重定向只在同源内跟随，检查请求 URL 即覆盖每一跳。详见[安全设计](security.zh-CN.md)。

非 2xx 响应是正常结果，不抛错。

## 4. 组合与 provider 选择

### 4.1 ctx.web 如何选择

`ctx.web` 允许注册多个 fetch provider，每次请求选一个：

1. 取 `web` 行的 `fetchProvider`（volatile，下一次请求即生效）；没有则取启动时的 `$DSH_WEB_FETCH_PROVIDER`；
2. 有 id：未注册报 `WEB_PROVIDER_CONFIGURED_MISSING`，`available()` 为 false 报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；
3. 没有 id：只有一个可用 provider 时选它；多个报 `WEB_PROVIDER_AMBIGUOUS`；没有报 `WEB_PROVIDER_UNAVAILABLE`。

重复注册同一个 id 会立即报 `WEB_DUPLICATE_PROVIDER`。没有 last-wins，也没有自动 fallback。

### 4.2 drop-in 席位

DSH 0.2.1 的 base bundle 带有四行 Web 相关配置：`web`（`searchProvider: deepseek-official`、`fetchProvider: http`）、`web-search-deepseek`、`web-deepseek-api` 和 `web-fetch-http`。本插件的 bundle patch：

~~~yaml
- id: web-fetch-http
  disabled: true
- insert:
    - id: web-fetch-enhanced
      name: dsh-web-fetch-enhanced
~~~

原生行停用后，id `http` 空出来，本插件以 `providerId: http`（默认值）注册。`web` 行原有的 `fetchProvider: http` 不需要任何修改就会选中本插件。

### 4.3 为什么不碰 web 行

patch 会整体替换目标行的 `config`，不做深合并。0.0.3 到 0.0.12 的 bundle patch 把 `web.config` 改写成只有 `fetchProvider: http-enhanced`，`searchProvider` 随之丢失。DSH 0.2.1 的 base 挂载了 `web-deepseek-api`，它注册的 `deepseek-search-api` 和 `deepseek-fetch-api` 的 `available()` 始终为 true，于是 `web_search` 在 `deepseek-official` 和 `deepseek-search-api` 之间自动选择失败，报 `WEB_PROVIDER_AMBIGUOUS`。这一点已在真实的 0.2.1-rc.2 组合上复现。

占用原生 id 后，插件不需要改写 `web` 行，也就不会覆盖其他插件或用户写下的选择。[tests/bundle.spec.ts](../tests/bundle.spec.ts) 用 include 插件真实的 patch 语义套用 bundle patch，断言 `web` 行与 base 完全一致。

### 4.4 官方开关

**插件 → 内置插件配置 → 网页搜索** 里的“启用新版 Web 搜索 API”开关把 `web` 行的两个字段写进用户层：打开时为 `deepseek-search-api` / `deepseek-fetch-api`，关闭时回到 `deepseek-official` / `http`（与 base 相同时直接移除覆盖）。因此：

- 打开：`web_fetch` 由 DeepSeek Fetch API 提供，本插件不参与，插件页显示提示，运行时上下文也不再出现；
- 关闭：`fetchProvider` 回到 `http`，即本插件。

### 4.5 共存模式

确有组件必须使用原生 `http` provider 时，用 [examples/coexist.cordis.yml](../examples/coexist.cordis.yml)：插件改为 `providerId: http-enhanced`，重新启用 `web-fetch-http`，`web` 行同时写明 `searchProvider` 和 `fetchProvider: http-enhanced`。这个 patch 改写了 `web` 行，所以必须写全两个字段；之后应用的、只写一个字段的 patch 仍会破坏它。官方开关关闭时写入的是 `http`，在共存模式下会指向原生 provider。

## 5. 配置生命周期

### 5.1 字段与热更新

Loader 拥有插件行的配置。`providerId` 是普通值，修改它会让 Loader 重建插件实例，重新注册 provider。其余业务字段都是 `.volatile()`：Loader 提供稳定的 live ref，插件用 `.get()` 读取当前值，修改不重建实例。

### 5.2 每次请求一份快照

`readSettings(config)` 一次读出所有 volatile 字段，返回普通对象。local 后端在每次请求开始时调用它一次，并据此构造 `AddressPolicy` 和 `HttpFetchProvider`。同一请求的所有重定向跳都使用这份快照；保存新配置只影响之后的请求。

### 5.3 原子校验

Loader 在提交任何字段之前校验整个候选配置。任一字段非法，整个候选都不生效，运行中的值保持不变。[tests/plugin.spec.ts](../tests/plugin.spec.ts) 覆盖了“合法白名单 + 非法 UA”一起提交时什么都不生效的情况。白名单字段的校验就是构造一次 `AddressPolicy`，与运行时使用同一套语法。

### 5.4 hostChecked：Host 校验，浏览器收到普通 schema

Settings 把 schema 序列化成 JSON 发给浏览器，序列化时去掉 transform 的回调。浏览器拿到一个没有回调的 transform 节点，解码必然失败，表单会一直停在加载中（0.0.7 修复过这个问题）。`hostChecked(schema, check)` 在 Host 上返回带校验的 transform，但重写 `toJSON`，输出内层普通 schema，并合并默认值、volatile 标记和说明。浏览器端用 `rules.ts` 自己执行同样的规则，不丢失任何反馈。Host 校验仍是唯一的权威边界。

### 5.5 配置格式迁移

`withConfigMigrations` 用 Proxy 包住对象 schema，在直接调用和 Standard Schema 的 `validate` 两条入口之前先运行 `migrateConfig`。不使用根 transform，是因为那会隐藏字段，Settings 和 Loader 就看不到 volatile 元数据。规则见[配置参考的格式版本一节](configuration.zh-CN.md#配置格式版本)。

`createProvider(raw)` 用同一个 `Config` 解析一次原始配置，得到的 provider 使用固定的配置，适合自定义 Host 或脚本。

## 6. 给模型的运行时上下文

模型通常被训练成只抓公网，看到内网或 Fake-IP 地址会直接拒绝。插件在 `systemPrompt` 服务存在时注册一条运行时上下文：

- 名称 `web-fetch-enhanced:allowlist`，顺序紧跟 `SANDBOX_POLICY`，`interpolate: false`（白名单文本按原样输出，不做模板变量替换）；
- 文本在每次请求时重新求值：没有 CIDR，或 `web_fetch` 当前不路由到本插件时为空；
- 是否路由到本插件：在插件自己所在的子树中找 id 为 `web` 的同级行（真实 Profile 把各行挂在 include 子树里），读它的 `fetchProvider`，没有则读 `$DSH_WEB_FETCH_PROVIDER`，与插件注册的 id 比较。找不到 `web` 行（自定义组合）或没有指定 id 时，视为路由到本插件；
- 这是可选上下文。preset 设置 `includeRuntimeContext: false` 时它不会出现。0.0.12 及以前是系统提示词中的固定 section，不受这个开关影响；
- 用运行时上下文而不是系统提示词 section，是为了跟随热更新和 provider 选择，同时不让缓存的系统提示词失效。

上下文随插件的 Fiber 一起注销。

## 7. 浏览器端

### 7.1 产物与模块边界

`lib/client.cjs` 由 tsdown 构建为 CJS，外层包成 `window.__ModuleLoader__.load({ id, factory })`，由 DSH 的模块加载器执行。React、`react/jsx-runtime` 和 `@deepseek-ai/*` 从壳的模块表中 `require`，不打进包里；ipaddr.js 不在模块表中，因此打进包里。浏览器代码运行时只能导入平台模块，其余依赖只允许类型导入。[tests/bundle.spec.ts](../tests/bundle.spec.ts) 加载构建产物，检查它只请求壳提供的模块。

`rules.ts` 和 `contract.ts` 同时被 Host 和浏览器使用，必须保持同构：不导入 Node 内置模块或 Host 包。

### 7.2 注册

`apply` 注入 `slots`、`locale`、`configForms`，并用 `ctx.effect` 注册所有资源，随 Fiber 释放：

- 词典命名空间 `settings.webFetchEnhanced`；
- 样式：把 `style.css` 的文本插入一个 `<style data-plugin="dsh-web-fetch-enhanced">`，卸载时移除；
- 控制器：订阅插件行 `configForms.get('web-fetch-enhanced')` 和只读的 `configForms.get('web')`；
- 页面：在 `configForms.whileServed(['web-fetch-enhanced'], …)` 内向 `plugins.bundle.config` 注册，key 为包名。插件行停用或不存在时，页面不出现。

### 7.3 控制器与状态

`SettingsPageController` 持有草稿，发布 `SettingsPageState`：

- 第一次编辑时记下表单 revision。保存时把所有草稿合成一个操作列表，调用一次 `form.mutate(ops, revision)`；revision 已变化时 Host 拒绝写入；
- 每个字段有自己的转换规则：白名单清空保存为 `[]`；User-Agent 原样保存，空字符串就是空请求头；数值字段留空表示移除覆盖；
- 用户层存在该字段时标记“已自定义”；“重置”暂存移除覆盖的操作，并显示继承值；
- 保存被拒绝或出错时保留草稿，显示失败，并清掉记下的 revision，再次保存会把草稿写到当前 revision 上；
- 路由提示读取 `web` 行的 `fetchProvider`，只提示能确认的两种情况：为空时提示未指定 provider，可能因歧义失败；为 `deepseek-fetch-api` 时提示官方开关已打开及关闭方法。其他 id 不提示：插件的 `providerId` 不是浏览器可见的 live 字段，页面无法判断一个自定义 id 是不是本插件（共存模式下的 `http-enhanced` 就是这种情况）。

### 7.4 平台组件

页面框架用 `@deepseek-ai/dsh-client-ui-primitives` 的 `SettingsForm`（不可用、只读、保存、失败状态，卸载时丢弃草稿），单行字段用 `SettingsValueField`（带“已自定义”和“重置”），标记用 `Tag`。多行白名单输入框、逐行提示、预设按钮和“限制”折叠区由插件自己渲染；任一限制字段非法时折叠区自动展开。

## 8. 错误契约

所有抓取错误都是 DSH 的 `WebError`。

| code | 来源 | 情况 |
| --- | --- | --- |
| `WEB_INVALID_URL` | 官方 transport | URL 无法解析、scheme 不是 http(s)、超过 2048 字符 |
| `WEB_BLOCKED_URL` | 官方 transport | URL 内嵌用户名或密码 |
| `WEB_BLOCKED_URL` | 本插件 | URL 主机是白名单外的非公网 IP 字面量；某个解析结果是白名单外的非公网地址；经 NAT64 映射到白名单外的非公网 IPv4；配置了域名规则而域名未命中 |
| `WEB_REDIRECT_BLOCKED` | 官方 transport | 跨源重定向；超过 `maxRedirects` |
| `WEB_FETCH_TOO_LARGE` | 官方 transport | 声明的 Content-Length 超过 `maxResponseBytes`（流式超出只截断并标记 `truncated`） |
| `WEB_FETCH_TIMEOUT` | 官方 transport | 超过 `timeoutMs`，包括等待 DNS |
| `WEB_UNSUPPORTED_CONTENT_TYPE` | 官方 transport | 非文本 MIME，或无法识别的 charset |
| `WEB_ABORTED` | 官方 transport | 调用方取消，包括 DNS 解析期间 |
| `WEB_PROVIDER_ERROR` | 官方 transport | 连接、TLS、读流失败；重定向缺少或带有非法 Location |
| `WEB_PROVIDER_ERROR` | 本插件解析器 | 域名没有解析结果，或解析结果不是合法 IP |
| `WEB_PROVIDER_CONFIGURED_MISSING` 等 | `ctx.web` | provider 选择失败，见 4.1 |

配置错误不是 `WebError`：Loader 拒绝候选配置，消息中带字段名和出错的规则，例如 `allowCidrs entry "198.18.1.1/15" must name its network address 198.18.0.0/15`。模型侧工具的外层超时可能表现为 `TOOL_TIMEOUT`，这是 DSH 已有的两层超时设计。

## 9. 扩展点

`createFetchService` 是唯一的扩展点：它占用 `ctx.web` 的一个席位，按请求把调用交给选中的后端。新增后端不需要改动 Host 组合，只需新增后端模块、volatile 的选择字段和页面分区。步骤、候选后端和必须遵守的披露、出站、凭据与 fallback 规则见 [Provider 与路线图](providers.zh-CN.md)。
