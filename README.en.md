# dsh-web-fetch-enhanced

[中文](README.md) · [English](README.en.md)

A DeepSeek Harness (DSH) plugin that lets `web_fetch` reach the non-public addresses you explicitly approve, such as a Clash / Mihomo fake-IP range or an intranet documentation site, while every other safety check stays the official HTTP fetch implementation. Installing it replaces the native provider in place: the model-facing tool name, arguments, and results do not change, and with no ranges configured it behaves exactly like the native provider.

## What problem it solves

The native `web_fetch` connects only to public unicast addresses. That is the SSRF boundary, and it also blocks trusted targets with `WEB_BLOCKED_URL`:

- with fake-IP enabled, Clash, Mihomo, and similar proxies resolve public domains into `198.18.0.0/15` and take over the connection;
- an agent needs to read an intranet wiki, a self-hosted documentation site, or another private service.

The plugin adds two exception layers that you configure:

1. a **CIDR allowlist**: the non-public IPv4 / IPv6 ranges that may be reached;
2. an optional **hostname allowlist**: only these hostnames may use those ranges.

Public addresses stay reachable either way; neither list restricts them.

## Install

Requires DSH `>=0.2.1-rc.2 <0.3.0-0`.

```bash
dsh plugin --profile web add dsh-web-fetch-enhanced
```

The bundle patch does two things only: it disables the native `web-fetch-http` row and inserts this plugin's `web-fetch-enhanced` row. The shared `web` row is left as it is.

- With DSH 0.2.1 hot reload (HMR) the install usually takes effect at once. If it does not, restart the Host; if the settings page does not appear in the browser, reload the page once.
- **Upgrading**: under HMR, adding an already installed package returns `already-installed`. Use Update on the Plugins page (it removes, then adds), or run:

  ```bash
  dsh plugin --profile web remove dsh-web-fetch-enhanced
  dsh plugin --profile web add dsh-web-fetch-enhanced@<version>
  ```

- Upgrading from 0.0.x to 0.1.0 is breaking; read the upgrade steps in the [CHANGELOG](CHANGELOG.md) first.
- Removing the plugin re-enables the native `web-fetch-http` row.

## Configure on the Plugins page

Open DSH Web and go to **Plugins → Web Fetch Enhanced**. The page has two groups:

- **Private network access**: "Allowed ranges (CIDR)" and "Only for these hostnames (optional)", one rule per line;
- **Requests**: the User-Agent, and under "Limits" the timeout, bytes read, characters returned, and redirects followed.

One Save button writes every change at once. A field you changed shows "Customized"; its Reset removes that override and restores the inherited value. Saved values apply to the next `web_fetch` without a restart; a request already running keeps the configuration it started with. Leaving the page drops unsaved edits.

### Common setups

**Fake-IP**: click "Clash / Mihomo fake-IP" to add `198.18.0.0/15`. It covers the default Clash / Mihomo `fake-ip-range`; if your proxy uses another range, enter that range.

**Hostname second factor**: a fake-IP range can carry any domain. To let only a few sites use the exception, list them under "Only for these hostnames":

```text
wiki.example.com
*.docs.example.com
```

`*.docs.example.com` matches subdomains only, not `docs.example.com` itself.

**Intranet sites**: open only the smallest range you need, for example `10.20.0.0/16`, not all of `10.0.0.0/8`.

### How the two lists combine

| Destination | Inside a CIDR | Hostname rules | Result |
| --- | --- | --- | --- |
| Public | not needed | not needed | allowed |
| Non-public | no | any | refused |
| Non-public | yes | none configured | allowed |
| Non-public | yes | configured, matched | allowed |
| Non-public | yes | configured, not matched | refused |

### Line-by-line checks

The page checks each line with the same rules the Host uses:

- **Errors** block saving and, where one correction is meant, offer it in one click. `198.18.1.1/15` has host bits set and becomes `198.18.0.0/15`; `https://wiki.example.com/page` is a URL and becomes `wiki.example.com`. A repeated line is an error too.
- **Warnings** do not block saving; they ask for a second look: the range includes the cloud metadata address `169.254.169.254`, includes loopback, is very broad (shorter than /8 for IPv4 or /16 for IPv6), or is public (public addresses are reachable anyway, so the line changes nothing).

Emptying a list and saving stores an explicit empty list, which revokes every inherited exception. That is not the same as Reset.

## YAML configuration

You can also configure the plugin row in the Profile's `cordis.patch.yml`; see [examples/allowlist.cordis.yml](examples/allowlist.cordis.yml):

```yaml
- id: web-fetch-enhanced
  config:
    allowCidrs:
      - 198.18.0.0/15
    allowHostnames:
      - '*.example.com'
```

A patch replaces the row's whole `config`, so restate every field you want to keep. Every field, default, and rule is described in the [configuration reference](docs/configuration.zh-CN.md) (Chinese).

## How it works

- The plugin registers one fetch provider in `ctx.web` with the id `http`, taking the native provider's seat; the `web` row's existing `fetchProvider: http` therefore selects it.
- Each request reads one configuration snapshot and runs through the official `HttpFetchProvider` from `@deepseek-ai/dsh-web-fetch-http`. URL rules, same-origin redirects, proxy routing, connection pinning, timeouts, size caps, and MIME / charset handling are upstream code.
- The plugin replaces only its DNS resolution: resolve once, check every answer. Public addresses pass; a non-public address must fall inside a CIDR and, when hostname rules exist, belong to a matching hostname. If any answer fails, the whole request is refused. IPv4 addresses reached through NAT64 are checked too.
- The validated address set is what the connection uses; the hostname is not resolved again after the check.
- When CIDRs are configured and this plugin serves `web_fetch`, it gives the model a runtime context naming the approved ranges and hostnames, so the model does not refuse intranet URLs up front.

## Compatibility and support policy

- DSH: `>=0.2.1-rc.2 <0.3.0-0`. 0.2.0-rc.2 is no longer supported; stay on 0.0.12 for that version.
- Node.js: `^22.19.0 || >=24.0.0`.
- Only DSH release candidates and stable releases are supported. Alpha builds and development snapshots change too often and carry no stable API, so they are not targeted.
- The DSH 0.3 series will be evaluated before the upper bound moves.

## FAQ

<details>
<summary><strong>The plugin page says web_fetch is served by "deepseek-fetch-api"</strong></summary>

"Use the new Web Search API" is on under **Plugins → Built-in plugin settings → Web search**. That switch routes `web_fetch` to the DeepSeek Fetch API, so this plugin's settings have no effect. Turn it off to switch back to `http`, which is this plugin. The DeepSeek Search / Fetch API itself is unaffected by this plugin.
</details>

<details>
<summary><strong>web_search or web_fetch fails with WEB_PROVIDER_AMBIGUOUS</strong></summary>

The `web` row lost `searchProvider` or `fetchProvider`. A patch replaces a row's whole `config`: a patch that writes one field drops the other, and the missing one falls back to automatic selection. DSH 0.2.1 mounts the DeepSeek Search / Fetch API providers by default and they are always available, so automatic selection finds several candidates and fails. The 0.0.12 bundle patch broke `web_search` exactly this way.

Fix: upgrade to 0.1.0, which no longer rewrites the `web` row; run `dsh --profile web --dump-config`, find the patch that writes only one field of `web`, and restate both. As a temporary workaround, set `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER`.
</details>

<details>
<summary><strong>After upgrading, web_fetch fails with WEB_PROVIDER_CONFIGURED_MISSING</strong></summary>

0.1.0 registers as `http` by default instead of `http-enhanced`. If your Profile still carries `web.fetchProvider: http-enhanced` or `providerId: http-enhanced` on the plugin row, remove those overrides; if you need `http-enhanced`, use the coexistence setup below.
</details>

<details>
<summary><strong>Why does *.example.com not match example.com?</strong></summary>

Wildcard rules match subdomains only. To allow both, list `example.com` and `*.example.com`.
</details>

<details>
<summary><strong>Why is a cross-site redirect refused?</strong></summary>

Only same-origin redirects (same scheme, host, and port) are followed, each hop checked again. A cross-origin redirect fails with `WEB_REDIRECT_BLOCKED`; the agent fetches the new URL in a separate call, so trust in one target never carries over to another site.
</details>

<details>
<summary><strong>Can I keep the native provider next to this plugin?</strong></summary>

Yes, but only when something must keep using the native `http` provider. See [examples/coexist.cordis.yml](examples/coexist.cordis.yml): the plugin uses `providerId: http-enhanced`, `web-fetch-http` is re-enabled, and the `web` row states both `searchProvider` and `fetchProvider`. Two providers cannot register the same id; that fails at startup with `WEB_DUPLICATE_PROVIDER`.
</details>

<details>
<summary><strong>Does the allowlist still apply with an HTTP proxy configured?</strong></summary>

A request routed through a proxy has its hostname resolved by the proxy and gets no local DNS check, exactly as with the native provider. The allowlist applies to direct requests and to IP literals. When the URL host is an IP literal, the plugin checks it first: a non-public address outside the allowlist is refused and never reaches the proxy.
</details>

## Documentation

The design documents are in Chinese.

- [Configuration reference](docs/configuration.zh-CN.md): fields, empty versus reset, YAML examples, provider selection, configuration format versions
- [Architecture](docs/architecture.zh-CN.md): modules, data flow, composition, browser face, error codes
- [Security](docs/security.zh-CN.md): threat model, fake-IP risks, review and rollout checklists
- [Providers and roadmap](docs/providers.zh-CN.md): the backend model and planned fetch backends
- [CHANGELOG](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)

## License and attribution

[MIT License](LICENSE). The plugin uses DeepSeek Harness's `@deepseek-ai/dsh-web-fetch-http` at runtime, and part of its DNS validation is adapted from that package; see [NOTICE](NOTICE). This is not an official DeepSeek package.
