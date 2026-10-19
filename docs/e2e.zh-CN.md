# 端到端测试

单元测试覆盖插件自身的各个部分；端到端测试回答只有真实组合才能回答的问题：插件管理器装进一个全新 Profile 后，bundle patch 叠加在官方 base bundle 之上是否落在正确的行，宿主启动后 `ctx.web` 是否真的把 `web_fetch` 交给本插件，设置页在 DSH Web 里是否能用。

测试代码即说明书：[e2e/](../e2e/) 下每个文件开头都写明了它做什么、为什么这样做。本文档讲怎么运行、环境如何隔离，以及不跑测试时如何手工部署同样的环境。

## 验证内容

| 文件 | 用例 |
| --- | --- |
| [host.e2e.ts](../e2e/host.e2e.ts) | 组合后 `web` 行保持 `searchProvider: deepseek-official` 与 `fetchProvider: http`，`web-fetch-http` 被禁用，插件行存在 |
| | 未放行时 `web_fetch` 访问回环地址报 `WEB_BLOCKED_URL` |
| | `web_search` 不报 `WEB_PROVIDER_AMBIGUOUS`（没有 DeepSeek key 时报 `WEB_PROVIDER_CREDENTIAL_MISSING` 属正常） |
| | 放行 `127.0.0.1/32` 后抓取成功，请求带配置的 User-Agent |
| | 模型收到的运行时上下文里有白名单说明 |
| [web.e2e.ts](../e2e/web.e2e.ts) | 插件页显示本插件的标题和设置 |
| | 输入带主机位的网段：显示错误、禁止保存；点“修正”后保存，Profile 中出现该值；“重置”后覆盖被移除 |
| | 在官方“网页搜索”页打开新版 API 开关后，本插件页出现路由提示；关掉后提示消失 |
| | 全程浏览器控制台无错误 |

宿主部分在测试进程内启动 Profile 的 host plane，步骤与 `dsh` CLI 相同（[support/host.ts](../e2e/support/host.ts)），不伪造任何服务，也不由测试注册 provider。GUI 部分启动真实的 `dsh web`，用 Playwright 驱动无头 Chromium。

## 运行

```bash
pnpm install
pnpm run test:e2e
```

`test:e2e` 先构建，再用 [vitest.e2e.config.ts](../vitest.e2e.config.ts) 运行。它不属于 `pnpm run check`：首次运行需要联网安装 DSH，耗时数分钟。

| 环境变量 | 作用 |
| --- | --- |
| `DSH_E2E_INSTALL` | 已有的 DSH 安装目录（其 `node_modules` 中有 `@deepseek-ai/dsh`）。不设置时安装到 `.e2e/dsh-<版本>` 并复用 |
| `DSH_E2E_CHROMIUM` | Chromium / Chrome 可执行文件。不设置时依次尝试 `/usr/bin/chromium`、`/usr/bin/chromium-browser`、`/usr/bin/google-chrome`，都没有则跳过 GUI 部分 |

前置条件：Node.js `^22.19.0 || >=24.0.0`、pnpm 11；首次运行能访问 npm registry（安装 DSH，以及 `dsh plugin add` 安装插件依赖）。代理变量会原样传给 npm / pnpm。

被测 DSH 版本取自 `package.json` 中 `@deepseek-ai/dsh-web` 的开发依赖版本，与单元测试编译所用的版本一致。升级宿主时改这一处，端到端测试随之使用新版本；DSH 启动步骤若有变化，只需调整 `support/host.ts`。

### 产物

| 路径 | 内容 |
| --- | --- |
| `.e2e/artifacts/*.png` | 各步骤的设置页截图（默认、错误行、已保存、路由提示） |
| `.e2e/artifacts/console-errors.json` | 浏览器控制台错误 |
| `.e2e/run/web.log` | `dsh web` 的输出 |
| `.e2e/run/home/profiles/web/` | 测试用 Profile，可直接查看 `cordis.yml`、`package.json` |

`.e2e/` 已加入 `.gitignore`。

## 隔离

一次运行的所有写入都在 `.e2e/run` 下，每次运行开始时清空重建（[global-setup.ts](../e2e/global-setup.ts)、[support/environment.ts](../e2e/support/environment.ts)）：

| 变量 | 指向 | 隔离的内容 |
| --- | --- | --- |
| `DSH_HOME` | `run/home` | Profile、设置、凭据、会话 |
| `HOME` | `run/os-home` | `~/.npmrc`、`~/.gitconfig` 等用户级配置 |
| `XDG_CACHE_HOME` / `XDG_CONFIG_HOME` / `XDG_DATA_HOME` | `run/cache` 等 | 各类缓存与数据 |
| `TMPDIR` | `run/tmp` | 临时文件 |
| `DSH_AGENTS_HOME` / `DSH_BUNDLED_SKILL_DIR` | `run/agents` / `run/skills` | 用户级 AGENTS.md、agent preset、技能 |
| `npm_config_cache` / `COREPACK_HOME` | `run/npm-cache` / `run/corepack` | npm 缓存、Corepack |
| pnpm store | `run/pnpm-store`（`--store-dir`） | 插件依赖 |

另外清除 `DSH_WEB_SEARCH_PROVIDER`、`DSH_WEB_FETCH_PROVIDER`、`DEEPSEEK_API_KEY`、`DEEPSEEK_TOKEN`：前两个会掩盖组合错误，后两个会让搜索真的发出请求。设置 `DSH_TELEMETRY_DISABLED=1`。

GUI 测试监听随机空闲端口，宿主测试用 [fixtures/host-plane.yml](../e2e/fixtures/host-plane.yml) 去掉 Web 服务相关的行，不监听任何端口。因此运行测试不会读写你自己的 DSH home、Profile、凭据，也不会影响正在使用的 DSH Web（默认 3080 端口）。

## 执行流程

1. **准备世界**：清空 `.e2e/run`，生成隔离环境变量。
2. **安装 DSH**：`npm install --prefix .e2e/dsh-<版本> @deepseek-ai/dsh@<版本>`，已安装则跳过；版本不符直接报错。
3. **打包插件**：`pnpm pack`（跳过 `prepack`，因为 `test:e2e` 已构建），得到与 npm 发布内容相同的 tarball。
4. **创建 Profile 并安装插件**：
   - `dsh --profile web --dump-config`：首次访问时按内置模板创建 `web` Profile；
   - `dsh plugin --profile web add <tarball> --store-dir <run/pnpm-store> --ignore-scripts`：与用户使用的插件管理器完全相同。
5. **宿主测试**：读取 `dsh --profile web --dump-config` 检查组合结果；按 CLI 的步骤启动 host plane（加载 Profile → 解析包 → 读取 bundle 与用户 patch 层 → 启动），叠加测试用 overlay，通过 `ctx.web` 抓取一个本地页面。
6. **GUI 测试**：`dsh web --no-open --host 127.0.0.1 --port <随机>`，从输出中取一次性登录 URL；Playwright 打开它，关掉新 home 首次出现的“预览须知”“开始使用”对话框，进入插件页操作；每个用例结束前把 Profile 恢复原样。

## 手工部署同一环境

不跑测试、想亲手点一点时，可以按下面的命令搭一个同样隔离的环境。路径以仓库根目录为例，按需替换。

```bash
# 0. 构建并打包插件
pnpm run build
pnpm --config.ignore-scripts=true pack --pack-destination .e2e/manual

# 1. 隔离环境：所有写入都落在 .e2e/manual 下
export E2E="$PWD/.e2e/manual"
export DSH_HOME="$E2E/home" HOME="$E2E/os-home" TMPDIR="$E2E/tmp"
export XDG_CACHE_HOME="$E2E/cache" XDG_CONFIG_HOME="$E2E/config" XDG_DATA_HOME="$E2E/data"
export DSH_AGENTS_HOME="$E2E/agents" DSH_BUNDLED_SKILL_DIR="$E2E/skills" DSH_TELEMETRY_DISABLED=1
unset DSH_WEB_SEARCH_PROVIDER DSH_WEB_FETCH_PROVIDER DEEPSEEK_API_KEY DEEPSEEK_TOKEN
mkdir -p "$DSH_HOME" "$HOME" "$TMPDIR"

# 2. DSH CLI（与 e2e 共用缓存目录）
VERSION=$(node -p "require('./package.json').devDependencies['@deepseek-ai/dsh-web']")
DSH="$PWD/.e2e/dsh-$VERSION/node_modules/.bin/dsh"
[ -x "$DSH" ] || npm install --prefix ".e2e/dsh-$VERSION" "@deepseek-ai/dsh@$VERSION"

# 3. 创建 web Profile 并安装插件（--profile 必须写在转给 pnpm 的参数之前）
"$DSH" --profile web --dump-config > /dev/null
"$DSH" plugin --profile web add "$E2E"/dsh-web-fetch-enhanced-*.tgz --store-dir "$E2E/pnpm-store"

# 4. 检查组合结果：web 行两个字段都在，web-fetch-http 为 disabled
"$DSH" --profile web --dump-config | grep -A4 -E '^- id: (web|web-fetch-http|web-fetch-enhanced)$'

# 5. 启动 GUI（换一个不冲突的端口），打开输出中的 http://127.0.0.1:3197/?token=... 链接
"$DSH" web --no-open --host 127.0.0.1 --port 3197
```

清理：停止 `dsh web` 后删除 `.e2e/manual`。

## 常见问题

- **`dsh plugin` 报参数错误**：`--profile` 必须紧跟在 `plugin` 之后、转给 pnpm 的参数之前。
- **重新安装时报 `ERR_PNPM_UNEXPECTED_STORE`**：`remove` 与 `add` 要传同一个 `--store-dir`；只设 `npm_config_store_dir` 不够可靠。
- **重新安装返回 `already-installed`**：DSH 0.2.1 的热加载下，已安装的包要先 `remove` 再 `add`。自动测试每次都用全新 home，不受影响。
- **打包安装不跟随源码变化**：tarball 是一次性的快照。改代码后重新构建、打包、安装；需要热更新时用 `pnpm dev` 加 `link:` 安装（见 [CONTRIBUTING](../CONTRIBUTING.md)）。
- **浏览器打开后不是插件页**：一次性 token 换成 HttpOnly cookie 后才会进入应用，cookie 绑定主机名和端口；用 `localhost` 代替 `127.0.0.1` 会被视为另一个站点。新 home 首次打开还会弹出“预览须知”和“开始使用”对话框。
- **宿主测试的 stderr 里有若干 `pending (waiting for services: ...)`**：这些是依赖 Web 服务的可选行，宿主测试特意去掉了 Web 服务，属正常输出。
- **安装时出现 `ECONNRESET`**：registry 网络抖动，重跑即可；已安装的 DSH 会被复用。
