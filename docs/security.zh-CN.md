# 安全设计与上线检查表

## 1. 信任边界

<code>web_fetch</code> 的 URL 来自模型，必须视为不可信输入；DNS、HTTP 响应、redirect 与正文也都不可信。operator 的 Host composition 和本插件白名单属于受信配置。

本插件的核心安全假设是：只有 operator 能修改 <code>allowCidrs</code> 与 <code>allowHostnames</code>。白名单不会作为模型工具参数暴露。

## 2. 主要威胁与缓解

### SSRF 到本机、内网和元数据服务

默认策略只允许公网单播。loopback、RFC1918、link-local、CGNAT、ULA、benchmark/fake-IP、组播、保留网段均拒绝。只有显式 CIDR 例外可以扩大可达面。

云元数据地址（例如 <code>169.254.169.254</code>）不要加入白名单。也不要使用 <code>0.0.0.0/0</code>、<code>::/0</code> 或宽泛 RFC1918 网段来“解决”单一代理路由问题。

### DNS rebinding 与检查后再解析

解析使用完整答案集，一项失败则全部失败。通过策略的答案直接交给 request-local Undici lookup；transport 不会重新查询 URL hostname。URL hostname 仍保留用于 Host header 和 TLS SNI。

### 混合 DNS 答案绕过

攻击者可能返回一个公网地址和一个私网地址。实现不会挑选“第一个安全答案”，而是拒绝整个集合，避免连接层稍后选中私网答案。

### IPv4-mapped IPv6 与 NAT64

IPv4-mapped IPv6 按嵌入 IPv4 分类。对于活动 DNS64，自定义 RFC 6052 前缀通过 <code>ipv4only.arpa</code> 发现；映射后的 IPv4 也必须为公网或命中白名单。这样不会因 translator 的公网 IPv6 外观而隐藏内网 IPv4。

### Redirect 逃逸

只跟随 301、302、303、307、308；只允许 scheme、hostname 和 port 都相同的 redirect。每一跳重新执行 URL、DNS、白名单和连接固定。跨源地址必须由新的工具调用显式请求。

### 凭据与横向权限

请求固定为 GET，不发送 cookie、Authorization 或环境中的 ambient credentials，也不接受 URL username/password。自定义 User-Agent 不应包含秘密。

### 资源耗尽和恶意内容

URL、响应字节、解码字符、redirect 跳数和 provider 时间均有上限。只接受 HTML、XHTML、text/*、JSON/XML 与 +json/+xml；二进制内容拒绝。响应正文仍是外部不可信数据，模型必须把它作为数据而非指令。

## 3. fake-IP 特有风险

在 Clash/Mihomo fake-IP 模式下，<code>198.18.0.0/15</code> 往往是“任意域名”的代理句柄，而不是一个单一后端。放行整个网段意味着所有解析到该 fake-IP 池的域名都满足地址条件。

建议：

1. 确认该网段只由受控透明代理接管；
2. 只放行代理实际使用的最小 CIDR；
3. 若业务站点集合有限，同时配置 <code>allowHostnames</code>；
4. 确认代理对本机、内网和元数据目的地仍有独立拒绝规则；
5. 不要把普通 HTTP forward proxy 的地址误当作目标白名单；本插件没有实现 CONNECT 或代理认证。

<code>allowHostnames</code> 只能限制 URL hostname，不能验证代理最终选择的真实上游。最终路由仍依赖透明代理的可信配置。

## 4. 配置审查建议

对白名单变更做代码审查，并记录：

- CIDR 所有者和用途；
- 为什么原生 public-only 策略不适用；
- 是否属于 fake-IP、VPN、服务网格或真实内网服务；
- 是否可以增加 hostname 第二因子；
- 过期时间和撤销负责人；
- 代理/路由层仍保留哪些目的地拒绝规则。

## 5. 上线检查表

- [ ] 本插件挂在 Host composition，而不是 agent preset；
- [ ] <code>web.fetchProvider</code> 显式指向预期 ID；
- [ ] 若使用 <code>providerId: http</code>，原生 http provider 已禁用；
- [ ] <code>allowCidrs</code> 是最小范围且没有默认路由；
- [ ] 宽 fake-IP 网段已评估并尽可能增加 <code>allowHostnames</code>；
- [ ] loopback、RFC1918、link-local、云元数据仍有负向测试；
- [ ] 混合公网/私网 DNS 答案会失败；
- [ ] 同源 redirect 正常，跨源 redirect 失败；
- [ ] timeout、字节和字符上限符合部署预算；
- [ ] 代理不会把白名单地址绕到未授权的内网目的地；
- [ ] 运行 <code>pnpm run check</code> 并在实际 Profile 中执行一次允许和一次拒绝用例。

## 6. 安全报告

报告问题时请提供：DSH 版本、本插件版本、最小 composition、URL 的解析答案、预期/实际错误 code，以及是否启用 DNS64、fake-IP 或透明代理。不要在公开 issue 中提交凭据、内网域名或敏感响应正文。
