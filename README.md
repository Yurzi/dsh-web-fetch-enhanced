# dsh-web-fetch-enhanced

[中文](README.md) · [English](README.en.md)

> [!IMPORTANT]
> **本仓库已归档，不再维护。** 开发已迁到 [Yurzi/dsh-tool-web-enhanced](https://github.com/Yurzi/dsh-tool-web-enhanced)。npm 包名 `dsh-web-fetch-enhanced` 不变，0.2.0 起由新仓库发布，作为 [dsh-tool-web-enhanced-profile](https://www.npmjs.com/package/dsh-tool-web-enhanced-profile) 的一部分安装，不再单独安装。
>
> 从 0.1.x 升级：先在同一个 profile 里移除本插件（`dsh plugin --profile <profile> remove dsh-web-fetch-enhanced`），再安装 `dsh-tool-web-enhanced-profile`。0.1.x 的设置不会被读取或迁移：设置页会提示并提供“恢复默认设置”，之后在“本机 HTTP”连接里重新填写白名单。详见[从 0.1.x 升级](https://github.com/Yurzi/dsh-tool-web-enhanced#从-01x-升级)。
>
> 下文描述的是 0.1.x，仅供存档。

DeepSeek Harness（DSH）插件。它让 `web_fetch` 访问你明确授权的非公网地址，例如 Clash / Mihomo 的 Fake-IP 网段或内网文档站，其余安全检查全部沿用官方 HTTP 抓取实现。安装后直接替换原生 provider，模型侧的工具名、参数和结果都不变；不配置任何网段时，行为与原生一致。

## 解决什么问题

原生 `web_fetch` 只连接公网单播地址，这是防 SSRF 的边界。下面这些可信目标也会因此被拦截，报 `WEB_BLOCKED_URL`：

- Clash、Mihomo 等代理开启 Fake-IP 后，公网域名被解析到 `198.18.0.0/15`，连接再由代理接管；
- Agent 需要读取内网 wiki、自建文档站等私有网络服务。

本插件提供两层由你配置的例外：

1. **CIDR 白名单**：允许访问的非公网 IPv4 / IPv6 网段；
2. **域名白名单（可选）**：只有这些域名可以使用上面的网段。

公网地址始终照常访问，不受这两项影响。

## 安装

要求 DSH `>=0.2.1-rc.2 <0.3.0-0`。

```bash
dsh plugin --profile web add dsh-web-fetch-enhanced
```

随包的 bundle patch 只做两件事：禁用原生的 `web-fetch-http` 行，插入本插件的 `web-fetch-enhanced` 行。共享的 `web` 行保持原样。

- DSH 0.2.1 支持插件热加载（HMR），安装后通常即时生效；未生效时重启 Host。浏览器里看不到设置页时，刷新一次页面。
- **升级**：HMR 下对已安装的包再次 `add` 会返回 `already-installed`。在插件页点“更新”（它会先移除再安装），或手动执行：

  ```bash
  dsh plugin --profile web remove dsh-web-fetch-enhanced
  dsh plugin --profile web add dsh-web-fetch-enhanced@<版本>
  ```

- 从 0.0.x 升级到 0.1.0 有破坏性变化，先读 [CHANGELOG](CHANGELOG.md) 中的升级步骤。
- 移除插件后，原生 `web-fetch-http` 行恢复启用。

## 在插件页配置

打开 DSH Web，进入 **插件 → 增强网页获取**。页面分两组：

- **内网访问**：“允许的网段（CIDR）”和“仅限这些域名（可选）”，每行一条规则；
- **请求**：User-Agent，以及折叠在“限制”里的超时、读取字节数、返回字符数和重定向次数。

整页只有一个“保存”按钮，一次写入所有修改。被你改过的字段显示“已自定义”，旁边的“重置”会移除这项覆盖，恢复继承值。保存后下一次 `web_fetch` 就使用新值，无需重启；已在进行的请求继续使用开始时的配置。离开页面会丢弃未保存的修改。

### 常用配置

**Fake-IP**：点击“Clash / Mihomo Fake-IP”按钮，一键加入 `198.18.0.0/15`。它覆盖 Clash / Mihomo 默认的 `fake-ip-range`；如果你的代理用了别的网段，填写实际网段。

**域名第二因子**：Fake-IP 网段可以承载任意域名。如果只想让少数站点使用例外，在“仅限这些域名”中填写：

```text
wiki.example.com
*.docs.example.com
```

`*.docs.example.com` 只匹配子域名，不匹配 `docs.example.com` 本身。

**内网站点**：只放行实际需要的最小网段，例如 `10.20.0.0/16`，不要整段放行 `10.0.0.0/8`。

### 两层规则如何组合

| 目标地址 | 命中 CIDR | 域名规则 | 结果 |
| --- | --- | --- | --- |
| 公网 | 不需要 | 不需要 | 允许 |
| 非公网 | 否 | 任意 | 拒绝 |
| 非公网 | 是 | 未配置 | 允许 |
| 非公网 | 是 | 已配置且命中 | 允许 |
| 非公网 | 是 | 已配置但未命中 | 拒绝 |

### 逐行检查

页面用与 Host 相同的规则逐行检查输入：

- **错误**会阻止保存，并尽量给出一键修正。例如 `198.18.1.1/15` 带主机位，可改为 `198.18.0.0/15`；`https://wiki.example.com/page` 是 URL，可改为 `wiki.example.com`。重复行也算错误。
- **警告**不阻止保存，只提醒你再确认：网段包含云元数据地址 `169.254.169.254`、包含本机回环地址、范围过宽（IPv4 短于 /8，IPv6 短于 /16），或者是公网网段（公网本就可达，这一行不起作用）。

清空列表并保存，会显式写入空列表，撤销所有继承来的例外；这与“重置”不同。

## 用 YAML 配置

也可以在 Profile 的 `cordis.patch.yml` 里配置插件行，见 [examples/allowlist.cordis.yml](examples/allowlist.cordis.yml)：

```yaml
- id: web-fetch-enhanced
  config:
    allowCidrs:
      - 198.18.0.0/15
    allowHostnames:
      - '*.example.com'
```

patch 会整体替换该行的 `config`，要保留的字段都要写上。全部字段、默认值和语义见 [配置参考](docs/configuration.zh-CN.md)。

## 工作原理

- 插件在 `ctx.web` 注册一个 id 为 `http` 的 fetch provider，占据原生 provider 的位置；`web` 行原有的 `fetchProvider: http` 因此选中本插件。
- 每次请求读取一份配置快照，交给官方 `@deepseek-ai/dsh-web-fetch-http` 的 `HttpFetchProvider` 执行。URL 规则、同源重定向、代理路由、连接固定、超时、大小上限和 MIME / charset 处理都是官方代码。
- 插件只替换其中的 DNS 解析：完整解析一次，逐个检查所有答案。公网地址放行；非公网地址必须命中 CIDR，配置了域名规则时还要命中域名。任一答案不合规，整个请求被拒绝。经 NAT64 映射的 IPv4 也会检查。
- 通过检查的地址集直接用于连接，不会在检查后再次解析。
- 配置了 CIDR 且本插件正在服务 `web_fetch` 时，插件向模型提供一条运行时上下文，说明已授权的网段和域名，避免模型对内网 URL 直接拒答。

## 兼容性与支持策略

- DSH：`>=0.2.1-rc.2 <0.3.0-0`。0.2.0-rc.2 不再支持，仍在该版本的用户请使用 0.0.12。
- Node.js：`^22.19.0 || >=24.0.0`。
- 只支持 DSH 的 RC 版和正式版。Alpha 和开发快照变化频繁、没有稳定 API，不做适配。
- DSH 0.3 系列需要重新评估后才会放开上界。

## 常见问题

<details>
<summary><strong>插件页提示 web_fetch 当前由 “deepseek-fetch-api” 提供</strong></summary>

你打开了 **插件 → 内置插件配置 → 网页搜索** 中的“启用新版 Web 搜索 API”。这个开关会把 `web_fetch` 切到 DeepSeek Fetch API，本插件的设置随之不生效。关闭开关即可切回 `http`，也就是本插件。DeepSeek Search / Fetch API 本身不受本插件影响。
</details>

<details>
<summary><strong>web_search 或 web_fetch 报 WEB_PROVIDER_AMBIGUOUS</strong></summary>

原因是 `web` 行缺了 `searchProvider` 或 `fetchProvider`。patch 会整体替换一行的 `config`：只写一个字段的 patch 会丢掉另一个，缺失的那项进入自动选择。DSH 0.2.1 默认挂载的 DeepSeek Search / Fetch API provider 始终可用，自动选择因此找到多个候选而失败。0.0.12 的 bundle patch 就是这样导致 `web_search` 失败的。

修复：升级到 0.1.0（不再改写 `web` 行）；用 `dsh --profile web --dump-config` 查看 `web` 行，找到只写了一个字段的 patch，把两个字段都写全。临时规避可以设置环境变量 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER`。
</details>

<details>
<summary><strong>升级后 web_fetch 报 WEB_PROVIDER_CONFIGURED_MISSING</strong></summary>

0.1.0 默认注册为 `http`，不再是 `http-enhanced`。如果你的 Profile 里还留着 `web.fetchProvider: http-enhanced` 或插件行的 `providerId: http-enhanced`，删掉这些覆盖；确实需要 `http-enhanced` 时，按下面的共存模式配置。
</details>

<details>
<summary><strong>为什么 *.example.com 不匹配 example.com</strong></summary>

通配规则只匹配子域名。两者都需要时，分别写 `example.com` 和 `*.example.com`。
</details>

<details>
<summary><strong>为什么跨站跳转被拒绝</strong></summary>

只自动跟随同源重定向（协议、主机、端口都相同），每一跳都重新检查。跨源跳转报 `WEB_REDIRECT_BLOCKED`，需要由 Agent 对新地址单独发起一次抓取，避免把对一个目标的信任传给另一个站点。
</details>

<details>
<summary><strong>能否保留原生 provider，与本插件并存</strong></summary>

可以，但只在确有组件必须使用原生 `http` provider 时才需要。参考 [examples/coexist.cordis.yml](examples/coexist.cordis.yml)：本插件改用 `providerId: http-enhanced`，重新启用 `web-fetch-http`，并在 `web` 行同时写明 `searchProvider` 和 `fetchProvider`。两个 provider 不能注册同一个 id，否则启动时报 `WEB_DUPLICATE_PROVIDER`。
</details>

<details>
<summary><strong>配置了 HTTP 代理后，白名单还起作用吗</strong></summary>

走代理的请求由代理解析域名，Host 不做本地 DNS 检查，这与原生行为相同。白名单作用于直连的请求和 IP 字面量。URL 是 IP 字面量时，插件先检查它：白名单外的非公网地址直接拒绝，不会交给代理。
</details>

## 文档

- [配置参考](docs/configuration.zh-CN.md)：字段、清空与重置、YAML 示例、provider 选择、配置格式版本
- [架构](docs/architecture.zh-CN.md)：模块、数据流、组合方式、浏览器端、错误码
- [安全设计](docs/security.zh-CN.md)：威胁模型、Fake-IP 风险、审查与上线检查表
- [Provider 与路线图](docs/providers.zh-CN.md)：后端模型与计划中的抓取后端
- [端到端测试](docs/e2e.zh-CN.md)：在隔离的真实 DSH 中验证组合、抓取和设置页
- [CHANGELOG](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md)

## 许可证与来源

[MIT License](LICENSE)。运行时使用 DeepSeek Harness 的 `@deepseek-ai/dsh-web-fetch-http`，部分 DNS 校验逻辑改编自该包，详见 [NOTICE](NOTICE)。本项目不是 DeepSeek 官方包。
