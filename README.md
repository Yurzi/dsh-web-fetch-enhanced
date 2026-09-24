# dsh-web-fetch-enhanced

[中文](README.md) · [English](README.en.md)

> 为 DeepSeek Harness 提供安全、可控的增强型网页抓取：解决 Clash / Mihomo Fake-IP 与受信任内网目标被原生公网地址检查拦截的问题，同时保持模型侧 `web_fetch` 用法不变。

## 它解决什么问题？

DeepSeek Harness 原生 HTTP provider 默认拒绝所有非公网地址，这是重要的 SSRF 安全边界。但在以下场景中，目标明明可信，也可能被提前拦截：

- Clash、Mihomo 等透明代理的 Fake-IP 模式把公网域名解析到 `198.18.0.0/15`；
- Agent 需要读取企业内网文档站、自建知识库或其他受信任的私有网络服务；
- 本地代理在接管连接前，需要先通过 Harness 的地址检查。

本插件允许管理员显式配置两层例外：

1. **CIDR 白名单**：哪些非公网 IPv4 / IPv6 网段可以访问；
2. **域名白名单（可选）**：哪些域名可以使用上述 CIDR 例外。

没有配置任何 CIDR 时，行为与原生 provider 的“仅公网”默认值一致。

## 主要特性

- **与原生工具完全兼容**：不增加新模型工具，Agent 继续调用 `web_fetch`；
- **网页端即时配置**：在 DSH Web 设置中编辑白名单，保存后下一次抓取立即生效；
- **默认拒绝非公网目标**：只有明确命中的 CIDR 例外才会放行；
- **可选域名第二因子**：将可访问网段进一步限制到精确域名或 `*.example.com`；
- **DNS 全答案校验与连接固定**：所有解析结果都必须合规，连接只使用已验证的地址；
- **重定向逐跳复核**：仅跟随同源重定向，并在每一跳重新解析、校验和固定地址；
- **受限匿名请求**：只发送无 Cookie、无 Authorization、无 URL 凭据的 GET 请求；
- **完整资源上限**：限制 URL、响应字节、解码字符、重定向次数和超时时间；
- **IPv4 / IPv6 防护**：覆盖 IPv4-mapped IPv6 与活动 DNS64 / NAT64 目标检查；
- **全局出站代理协同**：无缝对接 DSH 全局 HTTP 代理路由（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`），同时严格禁止非公网 IP 字面量越权走代理，杜绝内网 SSRF 风险；
- **动态系统提示词协同**：当管理员配置了非公网白名单时，自动向模型系统提示词注入显式授权声明，消除模型因默认安全准则而产生“无法访问内网”的拒答幻觉。

## 版本兼容性与支持策略

- **最低支持的 DSH 版本**：`0.1.7-rc.1`
- **版本支持策略**：本插件**仅对 DeepSeek Harness 的 RC（Release Candidate）候选发布版本及后续稳定正式版提供支持**。由于 Alpha 或开发快照版本更迭频繁且缺乏稳定的 API 保证，本插件不再对 Alpha 等非 RC 阶段版本进行维护与适配。

## 快速开始

### 1. 安装到 Web Profile

推荐使用 DSH 的插件管理命令。安装包会把随包发布的 `cordis.patch.yml` 作为 Profile patch 层应用：

```bash
dsh plugin --profile web add dsh-web-fetch-enhanced
```

如果 Web Profile 已经在运行，请按你的部署方式重启对应的 Host 进程，使新插件和 Client face 完成装载。

本地源码开发时可以使用绝对路径：

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-web-fetch-enhanced
```

### 2. 配置白名单

打开 DSH Web，进入：

**插件 → dsh-web-fetch-enhanced**

详情页直接显示白名单表单，在“允许的 CIDR”中每行填写一个网段。例如 Clash / Mihomo 的常见 Fake-IP 配置：

```text
198.18.0.0/15
```

如果希望只有指定网站可以使用这个例外，再填写“允许的域名”：

```text
api.example.com
*.docs.example.com
```

点击“保存”，页面显示“已保存”并保留输入框。无需重启 Profile，下一次 `web_fetch` 就会使用新规则。

下方“包含的组件”由 DSH 展示插件运行状态，配置白名单不需要进入组件。

### 3. 正常使用 `web_fetch`

插件不会改变 Agent 的使用方式。你仍然可以直接用自然语言提出请求，例如：

> 读取 https://docs.example.com/guide，并总结部署步骤。

Agent 会照常调用 `web_fetch`；地址解析、白名单判断和安全传输由本插件在底层完成。

## 常见配置场景

### Clash / Mihomo Fake-IP

如果整个 Fake-IP 网段都由可信代理接管：

| 设置项 | 内容 |
| --- | --- |
| 允许的 CIDR | `198.18.0.0/15` |
| 允许的域名 | 留空 |

留空域名白名单表示：任意域名只要解析到已放行 CIDR，就可以使用该 CIDR 例外。公网地址仍照常访问。

### 只允许少量域名使用 Fake-IP

| 设置项 | 内容 |
| --- | --- |
| 允许的 CIDR | `198.18.0.0/15` |
| 允许的域名 | `api.example.com`、`*.docs.example.com` |

这是更严格的配置，适合代理规则不完全受你控制的环境。

### 访问受信任的内网站点

```text
# 允许的 CIDR
10.20.0.0/16

# 允许的域名
wiki.corp.example
*.docs.corp.example
```

请只放行实际需要的最小网段，不要为了方便加入整个 RFC1918 地址空间。

## 白名单规则

### CIDR

- 每行一个标准 IPv4 或 IPv6 CIDR；
- IPv4 必须使用四段十进制网络地址，例如 `192.168.1.0/24`；
- IPv6 不接受 `%eth0` 之类的 Zone ID；
- 必须填写网络基址，不能用带主机位的地址代替网段；
- 空白行会被忽略，重复条目会在设置页中提示并阻止保存。

### 域名

- 精确规则：`api.example.com`；
- 最左侧通配规则：`*.example.com`；
- `*.example.com` 匹配其子域名，但**不匹配** `example.com` 本身；
- 不要填写协议、路径或端口，例如 `https://example.com`、`example.com/path`、`example.com:8080` 都不是合法规则；
- 域名白名单只约束“非公网 CIDR 例外”，不会限制原本就允许访问的公网地址。

### 两层规则如何组合？

| 目标地址 | CIDR 命中 | 已配置域名白名单且域名命中 | 结果 |
| --- | --- | --- | --- |
| 公网地址 | 不需要 | 不需要 | 允许 |
| 非公网地址 | 否 | 任意 | 拒绝 |
| 非公网地址 | 是 | 未配置域名白名单 | 允许 |
| 非公网地址 | 是 | 是 | 允许 |
| 非公网地址 | 是 | 否 | 拒绝 |

## 设置页按钮说明

- **保存**：将两项白名单作为一次配置变更写入当前 Profile 的插件行；Host 校验失败或版本冲突不会显示为成功。
- **放弃修改**：丢弃尚未保存的编辑，恢复当前生效值。
- **恢复继承值**：将移除两项白名单覆盖的操作加入草稿；仍需点击“保存”才生效。继承值可能包含非空白名单，请检查保存后的生效值。
- **只读状态**：当前表单尚未就绪、配置行不可用或连接没有写权限；不会回退到其他 Profile 或全局配置。

## Profile 配置与旧版本迁移

从 DSH `0.1.7-rc.1` 起，本插件使用 Profile 拥有的 Cordis `Config`、`.volatile()` 和插件管理页的 `configForms` 表单，不再读取全局 `$DSH_HOME/settings.yaml`。

- 配置由 Schema 默认值与当前 Profile composition/patch 决定；Web 保存只修改选中的插件行。
- **清空输入并保存会显式写入 `[]`**，用于撤销继承的白名单。空数组具有安全意义，不再自动清理。
- **恢复继承与清空不同**：只有显式恢复操作才执行 `unset`，可能重新启用底层配置中的白名单。
- 升级前备份旧设置，将旧 `web-fetch-enhanced` 节中的授权规则逐项审查后迁入目标 Profile 的插件配置。插件不会自动将全局授权复制到所有 Profile。

详见 [0.1.7-rc.1 升级说明](docs/migration-0.1.7-rc.1.zh-CN.md)。

## 安全提示

> **白名单会扩大 Agent 可发起 HTTP 请求的网络范围。只放行你理解并信任的最小目标。**

请勿加入以下宽泛或敏感目标：

- `0.0.0.0/0` 或 `::/0`；
- 云元数据地址，例如 `169.254.169.254/32`；
- 不必要的整个 `10.0.0.0/8`、`172.16.0.0/12` 或 `192.168.0.0/16`；
- 由不可信代理、DNS 或租户共同控制的网段。

即使配置了白名单，Host 仍会重新执行完整的 CIDR、域名、DNS 和 provider 身份校验；浏览器端校验不是安全边界。详细威胁模型见 [安全设计](docs/security.zh-CN.md)。

## 高级配置

通常只需要在 Web GUI 中维护两项白名单。其他参数应由 Profile composition 管理：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `providerId` | `http-enhanced` | 注册到 `ctx.web` 的 fetch provider ID |
| `allowCidrs` | `[]` | 允许作为非公网例外的 IPv4 / IPv6 CIDR |
| `allowHostnames` | `[]` | 可选的精确域名或最左侧通配规则 |
| `maxResponseBytes` | `5,000,000` | 响应正文最大读取字节数 |
| `maxBodyChars` | `100,000` | 解码后最大字符数 |
| `timeoutMs` | `30,000` | 单次抓取超时（毫秒） |
| `maxRedirects` | `5` | 同源重定向最大跳数；`0` 表示不跟随 |
| `userAgent` | `dsh-web-fetch-enhanced/0.1.0` | 每个请求使用的 User-Agent |

默认安装（通过 bundle `cordis.patch.yml`）采用独立的 `http-enhanced` provider ID，并显式禁用原生的 `web-fetch-http`，以避免后续其他 Web 插件（如 search 插件）覆盖 `id: web` 的 config 时因 `fetchProvider` 变成未指定而触发 `WEB_PROVIDER_AMBIGUOUS`。需要自定义组合或 drop-in 替换时，参考：

- [独立 provider 示例](examples/coexist.cordis.yml)
- [drop-in 替换示例](examples/drop-in.cordis.yml)
- [手动 composition patch](examples/manual.cordis.patch.yml)
- [架构与 provider 选择语义](docs/design.zh-CN.md)

> 不要让原生 provider 和本插件同时注册同一个 ID，否则 Host 会以 `WEB_DUPLICATE_PROVIDER` 拒绝启动，而不是执行 last-wins 覆盖。

## 常见问题

<details>
<summary><strong>开启 Clash / Mihomo 后，为什么普通公网网页也被判定为非公网地址？</strong></summary>

Fake-IP 模式会把域名解析到 `198.18.0.0/15` 等保留网段，再由代理接管连接。原生 provider 在代理接管前执行地址检查，因此会拒绝该结果。将代理实际使用的 Fake-IP 网段加入 CIDR 白名单即可。
</details>

<details>
<summary><strong>修改白名单后需要重启吗？</strong></summary>

不需要。Web 设置保存成功后，下一次 `web_fetch` 会立即读取新策略。只有首次安装、移除或升级插件时，才可能需要按部署方式重新启动 Host。
</details>

<details>
<summary><strong>为什么设置卡片是只读的？</strong></summary>

请确认目标 Profile 的插件行已启用且配置表单可用，并检查当前连接的配置写权限。表单未就绪或已失效时不会尝试修改其他配置。

若在 DSH `0.1.7-rc.1` 中卡片正常显示，但两个输入框持续禁用，请更新到包含配置 schema 序列化修复的构建，重启 Host 后刷新页面。旧构建的自定义校验回调在传输中被移除，导致浏览器表单无法就绪；修复保留了 Host 端的完整校验。
</details>

<details>
<summary><strong>为什么 `*.example.com` 不能访问 `example.com`？</strong></summary>

通配规则只匹配子域名。若两者都需要，请分别加入 `example.com` 和 `*.example.com`。
</details>

<details>
<summary><strong>为什么某些跨站跳转会被拒绝？</strong></summary>

插件只自动跟随同源重定向。跨源地址需要由 Agent 对新的 URL 发起一次独立抓取，这可以避免把已验证目标的信任隐式传递给另一个站点。
</details>

## 开发与贡献

需要二次开发时：

```bash
pnpm install
pnpm run check
```

`pnpm run check` 会执行类型检查、lint、构建、测试与发布包校验。Host bundle 输出到 `lib/index.js`，浏览器 Client bundle 输出到 `lib/client.js`。

## 许可证与来源

本项目采用 [MIT License](LICENSE)。网络安全模型与部分实现基于 DeepSeek Harness 的 `@deepseek-ai/dsh-web-fetch-http`，详见 [NOTICE](NOTICE)。本项目不是 DeepSeek 官方包，除非发布者另有明确说明。
