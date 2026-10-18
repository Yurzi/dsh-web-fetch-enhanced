# 安全策略

白名单会扩大 `web_fetch` 可以访问的网络范围，属于安全敏感的接口。部署或审查前请阅读[安全设计与上线检查表](docs/security.zh-CN.md)。

## 报告漏洞

请私下联系仓库维护者报告；仓库启用了 GitHub 私密漏洞报告时也可以使用它。不要公开提交 issue。请提供：

- DSH 版本和插件版本；
- 最小的 Profile patch 或 Host 组合；
- 相关 URL 的 DNS 解析结果；
- 预期和实际的 `WebError` code；
- 是否启用了 Fake-IP、DNS64 / NAT64、透明代理或出站代理。

不要在报告中附带凭据、内网域名或敏感的响应正文。
