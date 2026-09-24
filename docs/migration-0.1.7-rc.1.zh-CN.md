# DSH 0.1.7-rc.1 适配与迁移说明

## 基线与版本门禁

此次按上游 `dsh-v0.1.7-rc.1` 源码及 npm 发布包核对接口，不将历史会话评估当作 API 规范。最低支持版本由 `0.1.5-rc.2` 提升为 **`0.1.7-rc.1`**。

- `engines.dsh` 和所有 DSH peer 范围为 `>=0.1.7-rc.1 <0.2.0`。
- DSH 开发依赖固定 `0.1.7-rc.1`，锁文件同步更新；Cordis 使用 4.0.4、Schemastery 使用 3.18.4、Loader 使用 1.0.5。
- 上游 `packages/boot/app-boot/src/plugin-compatibility.ts` 实际使用 `semver.satisfies(..., { includePrerelease: true })`。显式 rc 下界避免错误接纳更早版本，也能在常规包管理器 semver 语义下接纳目标 rc。
- 本次验证针对 rc.1；范围内的未来版本不代表已实测，0.2 系列需重新评估。没有添加版本豁免，也没有修改用户 Profile。

## 采用的上游新能力

| 接入面 | 原实现 | 本次迁移 |
| --- | --- | --- |
| Host 配置 | settings.installSection/register 与全局覆盖 | Profile-owned Config + `.volatile()` |
| 实时值 | 自定义 current/source/watch | Loader 稳定 live refs 的 `.get()` |
| 配置通知 | Settings watcher | `loader/volatile-update`；授权变更后通知系统提示词 |
| 客户端 | settingsScope + settings.plugin.item | 插件详情页 `plugins.bundle.config` 与订阅当前 Profile 的 configForms |
| 保存 | 比对 user layer 推测写入结果 | 单次批量 mutate、revision 乐观并发校验和 Promise<boolean> 结果 |
| 清空白名单 | unset 并自动清理空数组 | 显式保存 []；恢复继承才 unset |
| 类型契约 | 本地模拟 Settings/SystemPrompt seam | 公开 Loader、SystemPrompt、PluginManager 类型 |

注意：rc.1 的 volatile 字段是引用对象，不是自动变更的普通数组；没有使用未经上游证实的 `ctx.accept` API。`providerId` 不是 volatile 字段，修改 composition 中的身份会重建 provider，而不是把旧 ID 静默指向新配置。

白名单和资源限制在 schema 校验阶段完整验证，Loader 成功后原子更新；非法候选不会部分扩大授权。每个请求捕获一份配置快照，在途请求继续使用启动时规则，下一次请求使用新配置。

## 操作者迁移步骤

1. 备份旧版 `$DSH_HOME/settings.yaml` 与目标 Profile composition。
2. 将 Host 升级至 DSH `0.1.7-rc.1` 或更高的兼容版本，并安装/链接本插件新构建。
3. 审查旧 `web-fetch-enhanced` 节，将必要的 `allowCidrs`、`allowHostnames` 及资源限制迁入目标 Profile 的 `web-fetch-enhanced` 插件行 config；或在插件详情页直接编辑白名单。
4. 不再依赖全局 settings.yaml；本插件不会自动把全局授权复制到各 Profile，以免扩大网络访问权限。
5. 保存后确认生效值。清空 CIDR 并保存意味着明确撤销非公网例外；恢复继承可能重新启用底层白名单，两者不可混同。
6. 升级插件文件后按部署方式重载/重启 Host 并刷新 Web 页面；配置字段的正常保存不需要重启。
7. 在实际部署中验证一个明确授权目标及一个未授权私网目标；不要为了测试额外放宽生产白名单。

默认 bundle 行 ID 为 `web-fetch-enhanced`，插件详情页注册键为包名 `dsh-web-fetch-enhanced`。bundle 插槽不提供 owner form，客户端显式订阅该 Profile 行的 ConfigForm。手写 composition 改名时，需要使用宿主通用配置表单或配套调整订阅的行 ID；组件不会猜测其他行的配置。

白名单在包详情页直接显示，不再进入组件行或展开额外卡片。保存后保留字段并显示结果，宿主的组件状态列表位于表单下方。

## 输入框持续禁用的修复

在 rc.1 的真实页面中，插件行正常运行且 Host 可写，但两个白名单输入框持续禁用。原因是 `settings.describe` 的传输 schema 保留了 `transform` 节点，却移除了其 `callback`。浏览器的 `ConfigFormController.decode()` 调用 `SettingsSchemaService.validate()` 时因此失败，表单一直停留在 `loading`。

插件现在仅在 Host 的运行时 schema 中保留自定义校验；序列化时输出对应的普通数组和数值 schema，并保留默认值、上下界及 volatile 元数据。Host 的 ConfigEditor/Loader 仍通过原始 Standard Schema 校验完整候选，再持久化和提交 live refs；浏览器表单不承担 CIDR 和域名的安全校验。序列化节点身份保持稳定，避免无配置变化时递增 revision。

已运行的 Host 需要重载插件模块或重启后刷新浏览器，单独刷新页面不会替换内存中的旧 Host schema。

## 保持不变及不适用项目

- `web_fetch` 工具名称、请求参数和返回结果不变；实际 rc.1 WebFetchProvider、WebFetchResult、代理路由接口与现有实现兼容。
- DNS 全答案检查、连接固定、NAT64 检查、同源重定向、取消/超时、匿名 GET 与非公网默认拒绝策略保持。
- 本插件没有旧图标导出、PTC、session-start、自定义会话附件、workspaceFiles 或工具视图接入，不为追逐新特性引入无关的浏览器/终端权限。
- 程序化调用 `createProvider()` 的原始配置类型现在为 `ProviderConfig`；`Config` 表示 Loader 解析后的 live-ref 配置。旧客户端 settingsScope 相关 helper 不再导出。

## 验证入口

运行 `pnpm run check`：类型检查、类型感知 lint、Host/Client 构建、全部测试及 publint。测试覆盖版本门禁、真实 Loader 热配置生命周期、原子拒绝非法候选、系统提示词刷新、请求快照、表单拒绝/版本冲突和既有 SSRF/代理回归。另在独立临时 Profile、DSH 0.1.7-rc.1 和 Chromium 中验收实际配置页面；该验收不代表运行中的用户 Profile 已重载插件。

本次验证结果：类型检查通过；类型感知 lint 为 0 warnings / 0 errors；Host、Client 与声明构建通过；13 个测试文件、100 项测试通过；发布覆盖率检查通过（行 99.54%、分支 95.48%）；`git diff --check` 通过。publint 退出码为 0，但保留一项提示：`./client` 的 `.js` 在 `type: module` 包中含 CJS 形式。该产物不是直接由 Node 导入的通用 ESM，而是 DSH `window.__ModuleLoader__.load` 的 factory 包装；已有构建产物测试验证实际 loader 注册与执行。没有为消除提示擅自改变宿主要求的客户端加载格式。

真实浏览器验收通过：插件详情页直接显示可编辑表单、保存后字段保持可见并显示成功、刷新保留值、Host 拒绝非法 CIDR 且保留草稿、放弃修改、显式空数组持久化、恢复继承并从 Profile patch 中移除覆盖。桌面与 390px 窄屏布局均已检查；双标签页验证了未编辑表单同步、外部更新保留草稿及过期 revision 拒绝写入。测试使用隔离的临时 Profile，未改动用户生产 Profile。
