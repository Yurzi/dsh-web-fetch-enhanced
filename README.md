# dsh-web-fetch-enhanced

[English](README.en.md) | 中文

面向 DeepSeek Harness 的可配置 HTTP(S) 抓取提供方。它保持原生 <code>web_fetch</code> 的模型工具接口不变，只替换 <code>ctx.web</code> 后面的 fetch provider，使指定的非公网 CIDR 可以通过显式白名单放行。

## 为什么需要它

DeepSeek Harness 原生 HTTP provider 会拒绝所有非公网地址。这是安全的默认值，但 Clash/Mihomo 等 fake-IP 模式常把域名解析到 <code>198.18.0.0/15</code> 一类保留地址，再由透明代理完成实际路由。原生检查会在代理接管前拒绝这些地址。

本插件增加两个默认关闭的例外维度：

- <code>allowCidrs</code>：允许哪些非公网 IPv4/IPv6 CIDR；
- <code>allowHostnames</code>：可选的第二因子，仅允许指定域名使用上述 CIDR 例外。

空白名单时行为与原生安全边界一致。

## 特性

- 默认拒绝全部非公网地址，公网单播地址照常访问；
- DNS 完整答案集校验：任意一个答案不合规就拒绝整个请求；
- 校验后连接固定，不让 HTTP transport 再次解析域名；
- IPv4、IPv6、IPv4-mapped IPv6 与活动 DNS64/NAT64 检查；
- 仅允许匿名 GET，不发送 cookie、Authorization 或 URL 内嵌凭据；
- 仅同源重定向，每一跳重新解析、校验并固定；
- URL、响应字节、解码字符、跳数与超时均有上限；
- 只返回 HTML 或文本，非 2xx 状态仍作为正常结果；
- provider ID 可配置，支持与原生 provider 共存或 drop-in 替换；
- 不注册新的模型工具，现有 <code>@deepseek-ai/dsh-tool-web</code> 与 <code>web_fetch</code> schema 无需变化。

## 安装到 Profile

本包与 DeepSeek Harness 内部 Host 插件一样，以 Cordis namespace plugin 发布；安装依赖后，将随包发布的 <code>cordis.patch.yml</code> 合并到 Profile 的 composition patch：

~~~bash
pnpm add dsh-web-fetch-enhanced
# 将 node_modules/dsh-web-fetch-enhanced/cordis.patch.yml 合并到 Profile patch
~~~

安装层默认注册 <code>http-enhanced</code>、把现有 <code>web.fetchProvider</code> 选到该 ID，但保持空白名单。然后把需要的配置**合并**到 <code>$DSH_HOME/profiles/&lt;profile&gt;/cordis.patch.yml</code>，不要覆盖文件中已有的其他 patch：

~~~yaml
- id: web-fetch-enhanced
  config:
    allowCidrs:
      - 198.18.0.0/15
~~~

验证最终组合：

~~~bash
dsh --profile <profile> --dump-config
~~~

插件是 Host 侧的 <code>ctx.web</code> provider，不应放入 agent preset。安装依赖不会自动修改 composition；请显式合并 [cordis.patch.yml](cordis.patch.yml)，也可参考 [manual.cordis.patch.yml](examples/manual.cordis.patch.yml)。

## 推荐接入：独立 provider ID

包内 [cordis.patch.yml](cordis.patch.yml) 已完成两项 Host 配置：完整重述 <code>web</code> 行的 <code>searchProvider</code>/<code>fetchProvider</code>，并通过 <code>- insert:</code> 插入 <code>web-fetch-enhanced</code> 行。原生 <code>http</code> provider 可以保留，因为 <code>ctx.web</code> 显式选择 <code>http-enhanced</code>，不依赖挂载顺序。

合并 composition patch 后，推荐使用 [coexist.cordis.yml](examples/coexist.cordis.yml) 作为 Profile 用户层配置。该示例覆盖已插入的行，因此不重复写 <code>name</code> 或 <code>- insert:</code>。

## fake-IP 示例

如果 fake-IP 范围代表所有经透明代理路由的域名，Profile patch 可以写为：

~~~yaml
- id: web-fetch-enhanced
  config:
    allowCidrs:
      - 198.18.0.0/15
~~~

如果只需少量站点使用例外，建议增加域名第二因子：

~~~yaml
- id: web-fetch-enhanced
  config:
    allowCidrs:
      - 198.18.0.0/15
    allowHostnames:
      - api.example.com
      - '*.docs.example.com'
~~~

<code>*.docs.example.com</code> 匹配子域名但不匹配 <code>docs.example.com</code> 本身。规则不接受端口或反斜杠；公网地址不受 <code>allowHostnames</code> 限制。

## Drop-in 替换

若希望继续使用 <code>fetchProvider: http</code>，在合并基础 composition patch 后再合并 [drop-in.cordis.yml](examples/drop-in.cordis.yml) 的 Profile patch。它会完整重述 <code>web</code> 配置、禁用原生 provider，并让本插件单独注册 <code>http</code>：

~~~yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http

- id: web-fetch-http
  disabled: true

- id: web-fetch-enhanced
  config:
    providerId: http
    allowCidrs:
      - 198.18.0.0/15
~~~

两个 provider 同时注册 <code>http</code> 会触发 <code>WEB_DUPLICATE_PROVIDER</code>，不会发生 last-wins 覆盖。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| <code>providerId</code> | <code>http-enhanced</code> | 注册到 <code>ctx.web</code> 的 fetch provider ID |
| <code>allowCidrs</code> | <code>[]</code> | 可作为非公网例外的 IPv4/IPv6 CIDR |
| <code>allowHostnames</code> | <code>[]</code> | 可选第二因子：精确域名或最左侧 <code>*.</code> 通配符 |
| <code>maxResponseBytes</code> | <code>5,000,000</code> | 响应正文最大读取字节数 |
| <code>maxBodyChars</code> | <code>100,000</code> | 解码后最大字符数 |
| <code>timeoutMs</code> | <code>30,000</code> | provider 级资源超时 |
| <code>maxRedirects</code> | <code>5</code> | 同源重定向最大跳数，0 表示不跟随 |
| <code>userAgent</code> | <code>dsh-web-fetch-enhanced/0.1.0</code> | 每个请求的 User-Agent |

配置错误会在插件启动时失败；不会静默忽略无效 CIDR、域名规则或资源上限。IPv4 CIDR 必须使用四段十进制和网络基址，IPv6 CIDR 不接受 zone ID，避免十六进制／八进制／短地址或主机位造成审计歧义。

## 安全提示

放行 CIDR 等于扩大 SSRF 可达面。尤其在 fake-IP 模式下，整个 fake-IP 网段可能代表任意域名；如果代理规则不可信，应同时配置 <code>allowHostnames</code>。不要为了方便放行 <code>0.0.0.0/0</code>、<code>::/0</code>、云元数据地址或整个 RFC1918 空间。

详细威胁模型、NAT64 行为和上线检查表见 [安全设计](docs/security.zh-CN.md)。架构与 provider 选择语义见 [设计文档](docs/design.zh-CN.md)。

## 开发

要求 Node.js <code>^22.19.0 || >=24</code> 与 pnpm。

~~~bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:coverage
pnpm run build
pnpm run check
~~~

开发时可直接加载与 DeepSeek Harness 内部插件相同的源码 overlay：<code>dsh web --patch ./cordis.source.patch.yml</code>。<code>pnpm run watch</code> 使用 tsdown 持续生成 Host ESM bundle；正式构建先由 TypeScript 生成 <code>lib/types</code>，再由 tsdown 输出 <code>lib/index.js</code>。

测试覆盖 CIDR/域名策略、混合 DNS、NAT64、连接固定、同源重定向、响应限制、取消/超时、Cordis 注册与真实 loopback 传输。

## 许可证与来源

MIT。网络安全模型与部分实现基于 MIT 许可的 DeepSeek Harness <code>@deepseek-ai/dsh-web-fetch-http</code>；详见 [NOTICE](NOTICE)。
