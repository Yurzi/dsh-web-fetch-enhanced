# 贡献指南

## 开发环境

需要 Node.js `^22.19.0 || >=24.0.0` 和 pnpm 11.7.0。

```bash
pnpm install
pnpm run check
```

## 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm run check` | 类型检查、type-aware lint、构建、测试和 publint，提交前必须通过；`prepack` 也会运行它 |
| `pnpm run dev` | `tsdown --watch`，持续构建 `lib/index.js` 和 `lib/client.cjs` |
| `pnpm run test` | 只运行测试 |
| `pnpm run test:coverage` | 测试并检查覆盖率下限（行 85%、分支 75%）。下限用来发现没有测试的模块，不是要追的指标 |
| `pnpm run test:e2e` | 在隔离的真实 DSH 中做端到端测试，见 [端到端测试](docs/e2e.zh-CN.md)。首次运行需联网安装 DSH |
| `pnpm run typecheck` / `pnpm run lint` / `pnpm run build` | 单独运行各步骤 |

## 开发循环

1. 运行 `pnpm run dev`；
2. 把源码目录以 link 方式装进一个测试用 Profile（用绝对路径）：

   ```bash
   dsh plugin --profile <profile> add link:/absolute/path/to/dsh-web-fetch-enhanced
   ```

3. DSH 0.2.1 的 HMR 会在 `lib` 变化时替换插件。浏览器端的修改刷新页面后生效；
4. 换回已发布的版本，或在 HMR 下升级已安装的插件时，先 `remove` 再 `add`。

不要在日常使用的 Profile 上开发。

## 约定

- 入口是 Cordis 的 namespace 插件（`name`、`inject`、`Config`、`apply`），**不能有 default export**；
- 源码使用带 `.ts` 扩展名的相对导入；
- 浏览器代码运行时只能导入壳模块表中的平台模块（React、Cordis、`@deepseek-ai/*`），其他包只能类型导入。`src/contract.ts` 和 `src/providers/local/rules.ts` 被两端共用，不能导入 Node 内置模块或 Host 包；
- 插件在 `ctx.web` 只注册一个 provider；新的抓取方式作为后端加入，见 [Provider 与路线图](docs/providers.zh-CN.md)；
- bundle patch 不改写共享行，尤其是 `web` 行；
- 测试在接缝处验证行为：真实的 Loader 组合、真实的官方 transport、本地 HTTP 服务、真实的 patch 语义、按用户操作驱动的页面。不为实现细节写断言，不写只为提高覆盖率的防御性测试；
- 用户可见的行为变化同时更新 README（中英文）、相关文档和 [CHANGELOG](CHANGELOG.md)。

## 安全相关的修改

地址分类、DNS、重定向、传输、超时、MIME 和白名单行为的修改都与安全相关。Pull request 需要包含：

1. 要解决的威胁或路由场景；
2. 不配置新选项时仍然默认拒绝；
3. 有针对性的正向和反向测试；
4. 涉及 DNS 时，对混合答案和 rebinding 的分析；
5. operator 可见行为的文档更新。

不要给这个 provider 增加凭据、任意请求头、由模型控制的白名单、环境代理认证、跨源重定向或子资源加载。这些能力需要单独的信任和审批设计。远程抓取后端必须遵守 [Provider 与路线图](docs/providers.zh-CN.md) 中的披露和出站规则。

## 端到端测试

单元测试不覆盖真实 Profile 的组合和浏览器页面。改动 bundle patch、provider 注册、设置页，或升级 DSH 基线时运行：

```bash
pnpm run test:e2e
```

它在 `.e2e/` 下的隔离环境里安装被测版本的 DSH，用插件管理器装入打包后的插件，真实启动 Host 和 DSH Web 验证组合、抓取和设置页，不会读写你自己的 DSH home 或正在运行的 DSH。运行方式、隔离细节和手工部署同一环境的命令见 [端到端测试](docs/e2e.zh-CN.md)。

## 发布检查

```bash
pnpm run check
pnpm run test:coverage
pnpm run test:e2e
pnpm pack --dry-run
```

确认 `package.json` 的版本、`engines.dsh` 和 peer 范围，CHANGELOG 中有对应版本，打包内容包含 `lib/`、`locale/`、`assets/icon.svg`、`cordis.patch.yml`、`examples/`、`docs/`、`CHANGELOG.md`、`README.en.md` 和 `NOTICE`。推送 `v<版本>` tag 后由 CI 发布，tag 必须与包版本一致。
