# dsh-web-fetch-enhanced

[中文](README.md) · [English](README.en.md)

> Safe, operator-controlled web fetching for DeepSeek Harness. It solves Clash / Mihomo fake-IP and trusted private-network access without changing how agents use `web_fetch`.

## What does it solve?

The native DeepSeek Harness HTTP provider rejects non-public addresses by default. That is an important SSRF boundary, but it can also block trusted targets in environments where:

- Clash, Mihomo, or another transparent proxy resolves public domains into a fake-IP range such as `198.18.0.0/15`;
- an agent must read a trusted intranet documentation site or self-hosted knowledge base; or
- a local proxy needs to take over the connection after Harness performs its address check.

This plugin adds two explicit exception layers:

1. a **CIDR allowlist** for non-public IPv4 and IPv6 ranges; and
2. an optional **hostname allowlist** that limits which hosts may use those CIDR exceptions.

With an empty CIDR allowlist, the security boundary remains equivalent to the native public-only provider.

## Highlights

- **No new model tool** — agents continue to call the existing `web_fetch` tool;
- **Live Web settings** — edit the allowlist in DSH Web and use it on the next fetch;
- **Deny non-public destinations by default** — only explicit CIDR matches become exceptions;
- **Optional hostname second factor** — restrict an allowed range to exact names or `*.example.com` rules;
- **Whole-answer DNS validation and address pinning** — every DNS answer must pass, and transport uses only validated addresses;
- **Redirect revalidation** — same-origin redirects are resolved, validated, and pinned again at every hop;
- **Anonymous bounded GET requests** — no cookies, Authorization header, or URL credentials;
- **Resource limits** — URL length, response bytes, decoded characters, redirects, and time are bounded;
- **IPv4 and IPv6 coverage** — including IPv4-mapped IPv6 and active DNS64 / NAT64 checks;
- **Outbound HTTP proxy alignment** — seamlessly respects DSH global proxy routes (`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`), while refusing unvalidated private IP literals from bypassing address checks through the proxy;
- **Dynamic system prompt alignment** — automatically injects explicit authorization guidance into the system prompt when non-public allowlists are configured, eliminating LLM refusal hallucinations when fetching authorized private destinations.

## Compatibility & Support Policy

- **Minimum Supported DSH Version**: `0.1.7-rc.2`
- **v0.0.8 update**: [Compatibility assessment and release notes](docs/releases/0.0.8.md).
- **Support Policy**: This plugin **only supports DeepSeek Harness RC (Release Candidate) releases and future stable releases**. Compatibility is not maintained for rapid-moving Alpha or development snapshot versions.

## Quick start

### 1. Install into the Web Profile

Use the DSH plugin manager. The package contributes its published `cordis.patch.yml` as a Profile patch layer:

```bash
dsh plugin --profile web add dsh-web-fetch-enhanced
```

If the Web Profile is already running, restart its Host process using your deployment's normal method so the new Host plugin and Client face are loaded.

For local source development, use an absolute link:

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-web-fetch-enhanced
```

### 2. Configure the allowlist

Open DSH Web and go to:

**Plugins → dsh-web-fetch-enhanced**

The details page shows the allowlist form directly. Enter one network per line under **Allowed CIDRs**. For a typical Clash / Mihomo fake-IP setup:

```text
198.18.0.0/15
```

To let only selected sites use this exception, add hostnames as a second factor:

```text
api.example.com
*.docs.example.com
```

Choose **Save**. The page shows **Saved** and keeps the fields visible. The next `web_fetch` uses the new policy; no Profile restart is required.

DSH displays component status below the form. You do not need to open a component to configure the allowlist.

### 3. Keep using `web_fetch` normally

The agent-facing workflow does not change. Ask naturally, for example:

> Read https://docs.example.com/guide and summarize the deployment steps.

The agent calls `web_fetch` as usual. This plugin performs address resolution, policy checks, and pinned transport underneath it.

## Common setups

### Clash / Mihomo fake-IP

When the entire fake-IP range is controlled by a trusted proxy:

| Setting | Value |
| --- | --- |
| Allowed CIDRs | `198.18.0.0/15` |
| Allowed hostnames | Empty |

An empty hostname list means any hostname may use an allowed CIDR exception. Public addresses remain available normally.

### Restrict fake-IP access to selected hosts

| Setting | Value |
| --- | --- |
| Allowed CIDRs | `198.18.0.0/15` |
| Allowed hostnames | `api.example.com`, `*.docs.example.com` |

This is the safer choice when you do not fully control the proxy's routing rules.

### Access a trusted intranet site

```text
# Allowed CIDRs
10.20.0.0/16

# Allowed hostnames
wiki.corp.example
*.docs.corp.example
```

Allow only the smallest range you actually need. Do not add all RFC 1918 space for convenience.

## Allowlist syntax

### CIDRs

- Enter one standard IPv4 or IPv6 CIDR per line.
- IPv4 uses four-part decimal network addresses, such as `192.168.1.0/24`.
- IPv6 zone IDs such as `%eth0` are not accepted.
- Use the network base address, not an address with host bits set.
- Blank lines are ignored. Duplicate entries are reported by the settings card and block saving.

### Hostnames

- Exact rule: `api.example.com`.
- Left-most wildcard rule: `*.example.com`.
- `*.example.com` matches subdomains but **does not match** `example.com` itself.
- Do not include a scheme, path, or port. Values such as `https://example.com`, `example.com/path`, and `example.com:8080` are invalid.
- Hostname rules apply only to non-public CIDR exceptions. They do not restrict destinations that were already public.

### How the two layers combine

| Destination | CIDR match | Hostname allowlist | Result |
| --- | --- | --- | --- |
| Public address | Not required | Not required | Allow |
| Non-public address | No | Any | Deny |
| Non-public address | Yes | Not configured | Allow |
| Non-public address | Yes | Match | Allow |
| Non-public address | Yes | No match | Deny |

## Settings actions

- **Save** writes both allowlists in one mutation to the selected Profile plugin row. Host rejection or a revision conflict is not reported as success.
- **Discard** drops unsaved edits and restores effective values.
- **Restore inherited values** stages removal of both allowlist overrides; choose **Save** to apply. Inherited values may contain a non-empty allowlist, so review the resulting policy.
- **Read-only** means the form is not ready, the row is unavailable, or the connection cannot write. The card never falls back to another Profile or global configuration.

## Profile configuration and migration

Starting with DSH `0.1.7-rc.1`, this plugin uses Profile-owned Cordis `Config`, `.volatile()`, and plugin-manager `configForms`. It no longer reads global `$DSH_HOME/settings.yaml`.

- Effective configuration combines schema defaults with the current Profile composition/patch. Web edits target only the selected plugin row.
- **Clearing a field and saving writes an explicit `[]`** to revoke inherited allowlists. Empty arrays are meaningful security overrides and are no longer pruned.
- **Restore is not clear**: only an explicit restore uses `unset`, which may reactivate an inherited allowlist.
- Back up legacy settings, review the old `web-fetch-enhanced` section, and move intended rules into the target Profile plugin configuration. Global authorizations are never automatically copied to every Profile.

See the [0.1.7-rc.1 migration notes (Chinese)](docs/migration-0.1.7-rc.1.zh-CN.md).

## Security guidance

> **An allowlist expands the network locations an agent can request. Allow only the smallest destinations you understand and trust.**

Do not allow broad or sensitive targets such as:

- `0.0.0.0/0` or `::/0`;
- cloud metadata endpoints such as `169.254.169.254/32`;
- all of `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16` unless genuinely required; or
- ranges jointly controlled by untrusted proxy, DNS, or tenant infrastructure.

The Host still performs complete CIDR, hostname, DNS, and provider validation after a Web edit. Browser validation is never the security boundary. See the [security design](docs/security.zh-CN.md) for the threat model and launch checklist.

## Advanced configuration

Most users only need the two allowlists exposed in DSH Web. Manage other values in the Profile composition:

| Field | Default | Purpose |
| --- | --- | --- |
| `providerId` | `http-enhanced` | Fetch provider ID registered in `ctx.web` |
| `allowCidrs` | `[]` | Non-public IPv4 / IPv6 CIDR exceptions |
| `allowHostnames` | `[]` | Optional exact hosts or left-most wildcard rules |
| `maxResponseBytes` | `5,000,000` | Maximum response bytes read |
| `maxBodyChars` | `100,000` | Maximum decoded characters |
| `timeoutMs` | `30,000` | Fetch timeout in milliseconds |
| `maxRedirects` | `5` | Maximum same-origin redirect hops; `0` disables following |
| `userAgent` | `dsh-web-fetch-enhanced/0.1.0` | User-Agent sent with each request |

The default bundle uses the separate `http-enhanced` provider ID and explicitly disables the native `web-fetch-http` provider to avoid `WEB_PROVIDER_AMBIGUOUS` when subsequent Web plugins (such as search plugins) overwrite `id: web` configuration and unpin `fetchProvider`. For manual composition or drop-in replacement, see:

- [coexisting provider example](examples/coexist.cordis.yml)
- [drop-in replacement example](examples/drop-in.cordis.yml)
- [manual composition patch](examples/manual.cordis.patch.yml)
- [architecture and provider selection](docs/design.zh-CN.md)

> Never register the native provider and this plugin under the same ID. The Host fails with `WEB_DUPLICATE_PROVIDER`; it does not use last-wins replacement.

## FAQ

<details>
<summary><strong>Why does enabling Clash / Mihomo make an ordinary public site look non-public?</strong></summary>

Fake-IP mode resolves the domain into a reserved range such as `198.18.0.0/15`, then takes over routing. The native provider checks the answer before the proxy can take over. Add the actual fake-IP range used by your proxy to Allowed CIDRs.
</details>

<details>
<summary><strong>Do allowlist changes require a restart?</strong></summary>

No. After a successful Web settings save, the next `web_fetch` uses the new policy. Installing, removing, or upgrading the plugin itself may require a Host restart depending on your deployment.
</details>

<details>
<summary><strong>Why is the settings card read-only?</strong></summary>

Verify that the target Profile plugin row is enabled, its form is available, and the current connection has configuration write permission. An unavailable form never falls back to a different configuration.

If both inputs remain disabled on DSH `0.1.7-rc.1` while the card renders normally, update to a build containing the configuration schema serialization fix, restart the Host, and refresh the page. Older builds expose custom validators whose callbacks are stripped during transport, preventing the browser form from becoming ready. The fix retains full Host validation.
</details>

<details>
<summary><strong>Why does `*.example.com` not allow `example.com`?</strong></summary>

Wildcard rules match subdomains only. Add both `example.com` and `*.example.com` when you need both.
</details>

<details>
<summary><strong>Why is a cross-site redirect blocked?</strong></summary>

The provider follows same-origin redirects only. The agent can issue a separate fetch for the new URL, preventing trust in one validated origin from being inherited by another.
</details>

## Development

For local development:

```bash
pnpm install
pnpm run check
```

`pnpm run check` runs type checking, lint, builds, tests, and package publication checks. The Host bundle is emitted as `lib/index.js`; the browser Client bundle is emitted as `lib/client.js`.

## License and attribution

This project is licensed under the [MIT License](LICENSE). Its network security model and parts of the implementation are based on DeepSeek Harness `@deepseek-ai/dsh-web-fetch-http`; see [NOTICE](NOTICE). This project is not an official DeepSeek package unless explicitly stated by its publisher.
