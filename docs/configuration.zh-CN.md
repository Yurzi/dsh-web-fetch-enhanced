# 配置参考

插件的配置属于当前 Profile 的 `web-fetch-enhanced` 行。可以在插件页编辑，也可以写在 Profile 的 `cordis.patch.yml` 中。两者修改的是同一行；同一个字段最好只用一种方式维护。

## 字段

| 字段 | 类型与范围 | 默认值 | 含义 | 热更新 | 插件页 |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | 非负整数 | 缺失按 v0 读取，迁移为 `1` | 配置格式版本，见文末 | 否 | 否 |
| `providerId` | 字母或数字开头，最多 128 个字母、数字、`.`、`_`、`-` | `http` | 注册到 `ctx.web` 的 provider id，`web.fetchProvider` 用它选择 | 否，修改会重建插件实例 | 否 |
| `allowCidrs` | CIDR 字符串数组 | `[]` | 允许访问的非公网 IPv4 / IPv6 网段 | 是 | 是 |
| `allowHostnames` | 域名规则数组 | `[]` | 非空时，只有这些域名可以使用 `allowCidrs` 中的例外 | 是 | 是 |
| `userAgent` | 一行可打印 Latin-1 字符，可为空 | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | 每个请求和每一跳重定向发送的 User-Agent；空字符串发送空请求头 | 是 | 是 |
| `maxResponseBytes` | 正整数 | `5000000` | 最多读取的响应字节数 | 是 | 是（限制） |
| `maxBodyChars` | 正整数 | `100000` | 解码后最多返回的字符数，超出时截断并标记 `truncated` | 是 | 是（限制） |
| `timeoutMs` | 1 到 2147483647 的整数 | `30000` | 单次抓取的总超时（毫秒），包括 DNS 和所有重定向 | 是 | 是（限制） |
| `maxRedirects` | 非负整数 | `5` | 最多跟随的同源重定向次数；`0` 表示不跟随 | 是 | 是（限制） |

默认值与官方 `web-fetch-http` 相同。所有数值字段只接受整数。热更新的字段保存后由下一次请求使用，已开始的请求不受影响。Loader 先校验整份候选配置，任一字段非法时整份都不生效。

User-Agent 不提供浏览器 TLS 指纹、JavaScript 执行或验证码处理，只换 UA 不能绕过反爬保护。不要在 UA 里放秘密。

## 白名单语法

### CIDR

- 每行一个 IPv4 或 IPv6 CIDR，必须带前缀长度；
- IPv4 写成四段十进制，例如 `192.168.1.0/24`。`010.0.0.0/8`、`10.1/16` 这类写法被拒绝；
- 必须写网络地址。`198.18.1.1/15` 被拒绝，修正为 `198.18.0.0/15`；
- IPv6 不能带区域标识（如 `%eth0`）；
- 不接受 IPv4 映射的 IPv6 网段，直接写对应的 IPv4 网段。匹配时，IPv4 映射和 IPv4 兼容的 IPv6 地址按其内嵌的 IPv4 判断；
- 公网地址不需要规则。写公网网段不会出错，但没有作用。

### 域名

- 精确规则：`wiki.example.com`，也可以是 IP 字面量；
- 通配规则：`*.example.com`，只匹配子域名，不匹配 `example.com` 本身。`*` 只能作为最左侧一整段，不能用于 IP；
- IPv6 字面量不能带区域标识，也只接受 URL 能表示的写法（例如不接受 IPv4 尾部带前导零的形式）；
- 不能带协议、路径、端口或 `@`。`https://wiki.example.com/page` 和 `wiki.example.com:8080` 被拒绝，修正为 `wiki.example.com`；
- 比较前统一转小写、去掉末尾的点，IPv6 去掉方括号并规范化；
- 域名规则只约束非公网例外，从不限制公网地址。

### 插件页的提示

| 类型 | 情况 | 是否阻止保存 |
| --- | --- | --- |
| 错误 | 不符合上述语法，可修正时给出一键修正 | 是 |
| 错误 | 与前面某行重复（按解析后的规则比较） | 是 |
| 警告 | 网段包含云元数据地址 `169.254.169.254` 或 `fd00:ec2::254` | 否 |
| 警告 | 网段包含 `127.0.0.1` 或 `::1` | 否 |
| 警告 | IPv4 短于 /8，或 IPv6 短于 /16 | 否 |
| 警告 | 公网网段，这一行不起作用 | 否 |

页面的检查与 Host 使用同一个模块，页面接受的行 Host 也会接受。Host 仍会在保存时重新校验。

## 清空与重置

插件页和 Profile 的用户层区分两种操作：

| 操作 | 写入 | 效果 |
| --- | --- | --- |
| 清空白名单后保存 | `allowCidrs: []` | 显式覆盖，撤销所有继承来的例外 |
| 点击“重置”后保存 | 移除该字段的覆盖 | 恢复继承值；继承值可能包含非空白名单 |
| 清空 User-Agent 后保存 | `userAgent: ''` | 发送空的 User-Agent 头，不是恢复默认 |
| 清空数值字段后保存 | 移除该字段的覆盖 | 恢复继承值 |

“已自定义”表示用户层中存在这个字段。离开页面会丢弃未保存的修改；保存被拒绝（例如配置已在别处改动）时草稿保留，再次保存会写到当前版本上。

## YAML 示例

patch 会整体替换目标行的 `config`，不做合并。要保留的字段都写上。

### 放行 Fake-IP，并限定域名

[examples/allowlist.cordis.yml](../examples/allowlist.cordis.yml)：

~~~yaml
- id: web-fetch-enhanced
  config:
    allowCidrs:
      - 198.18.0.0/15
    allowHostnames:
      - '*.example.com'
~~~

### 内网站点与限制

~~~yaml
- id: web-fetch-enhanced
  config:
    schemaVersion: 1
    allowCidrs:
      - 10.20.0.0/16
    allowHostnames:
      - wiki.corp.example
      - '*.docs.corp.example'
    timeoutMs: 15000
    maxRedirects: 3
~~~

### 与原生 provider 共存

[examples/coexist.cordis.yml](../examples/coexist.cordis.yml)：

~~~yaml
- id: web-fetch-http
  disabled: false

- id: web-fetch-enhanced
  config:
    providerId: http-enhanced
    allowCidrs:
      - 198.18.0.0/15

- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http-enhanced
~~~

这个 patch 改写了 `web` 行，因此 `searchProvider` 也必须写上，否则 `web_search` 会报 `WEB_PROVIDER_AMBIGUOUS`。如果你的搜索 provider 不是 `deepseek-official`，写你实际使用的 id。

## providerId 与 web.fetchProvider

`web_fetch` 由 `web` 行的 `fetchProvider` 选择 provider；没有设置时读环境变量 `DSH_WEB_FETCH_PROVIDER`；都没有时，在所有可用 provider 中自动选择，多于一个就报 `WEB_PROVIDER_AMBIGUOUS`。

| 部署方式 | 插件 `providerId` | 原生 `web-fetch-http` | `web.fetchProvider` |
| --- | --- | --- | --- |
| 默认（bundle patch） | `http` | 停用 | `http`（base 原值，不改） |
| 共存 | `http-enhanced` | 启用 | `http-enhanced`，同时写明 `searchProvider` |

规则：

- 插件 id 和原生 provider 都是 `http` 时，原生行必须停用，否则注册时报 `WEB_DUPLICATE_PROVIDER`；
- `web.fetchProvider` 指向一个没有注册的 id 时报 `WEB_PROVIDER_CONFIGURED_MISSING`。从 0.0.x 升级后若 Profile 里还留着 `http-enhanced`，删掉这条覆盖，或把插件的 `providerId` 也设为 `http-enhanced`；
- 检查合成结果：`dsh --profile web --dump-config`，确认 `web` 行同时有 `searchProvider` 和 `fetchProvider`，`web-fetch-http` 为 `disabled: true`（默认部署）。

## 官方 Web 搜索开关

**插件 → 内置插件配置 → 网页搜索** 中的“启用新版 Web 搜索 API”会把 `web` 行的 `searchProvider` 和 `fetchProvider` 一起写进用户层：

- 打开：`deepseek-search-api` / `deepseek-fetch-api`。`web_fetch` 由 DeepSeek Fetch API 提供，本插件不参与，插件页会提示，模型也不再收到白名单说明；
- 关闭：回到 `deepseek-official` / `http`。`http` 就是本插件，白名单重新生效。

恢复方法就是关闭开关。关闭后白名单仍不生效时，用 `dsh --profile web --dump-config` 查看 `web` 行，检查 Profile 的 `cordis.patch.yml` 中是否还有手写的 `fetchProvider` 覆盖。插件页只对两种情况给出提示：`fetchProvider` 为 `deepseek-fetch-api`，或没有指定；其他 id 页面无法判断是否为本插件，不提示。共存模式下，关闭开关写入的 `http` 指向原生 provider，需要重新把 `fetchProvider` 设为 `http-enhanced`。

注意：DeepSeek Fetch API 把 URL 发给 DeepSeek 的服务端抓取，不适用本插件的白名单，也无法访问你的内网。

## 配置格式版本

`schemaVersion` 是插件配置自己的格式版本，与 npm 包版本、DSH 版本和表单 revision 无关。当前为 `1`。

### 读取规则

- 字段缺失表示 v0（最初的无版本格式），显式写 `0` 也可以；读取时在内存中迁移到当前版本，不改写任何文件；
- 高于当前支持的版本直接报错，提示升级插件，不降级、不回退默认值；
- 非整数、负数、字符串等非法值报错；
- 迁移深克隆输入，保留未知字段和显式空数组。`[]` 有撤销授权的含义，迁移不能删除或替换它；
- 用户不需要给已有配置补版本号。新写的完整配置建议写上 `schemaVersion: 1`。

`Config(raw)`、Loader 和 Settings 使用的 Standard Schema 校验，以及 `createProvider(raw)` 都会先迁移再校验。`migrateConfig(raw)` 只做格式迁移，不代表配置合法。

### 什么时候需要 v2

只有已有字段的结构或含义发生变化时才升版，例如改名、改单位、拆分字段。新增一个可选字段、缺失时保持原有行为，不需要升版；新增抓取后端的设置就属于这种情况。

升到 v2 时：

1. 把 `CONFIG_SCHEMA_VERSION` 改为 2，在迁移表中增加 `1` 这一步，返回 `schemaVersion: 2`；保留已有步骤，每步只前进一个版本，不添加运行时默认值；
2. 对改名、单位变化和拆分写明规则。新旧字段同时出现时明确优先级或直接拒绝，不能猜测用户的授权意图；
3. 字段改名时，必须同时设计插件页的写入和分层持久化，不能只加读取转换。旧字段留在下层时，“重置”可能让它重新生效；
4. 测试覆盖所有历史版本直接升到当前版本、幂等、输入不被修改、非法和未来版本被拒绝；
5. 插件自身不回写配置文件。需要落盘迁移时，应由 Host 在知道配置来源的边界内按层迁移、校验、带 revision 原子写入。

会改变授权范围、又无法证明语义等价的迁移，不应自动执行。
