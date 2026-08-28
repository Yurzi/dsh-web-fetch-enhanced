# dsh-web-fetch-enhanced

English | [中文](README.md)

A configurable HTTP(S) fetch provider for DeepSeek Harness. It keeps the model-facing <code>web_fetch</code> tool unchanged and adds explicit CIDR exceptions to the non-public address filter behind <code>ctx.web</code>.

## Use case

Transparent fake-IP proxies may resolve ordinary domains into reserved ranges such as <code>198.18.0.0/15</code>. The native public-only provider correctly blocks those answers before the proxy can route them. This plugin lets an operator explicitly allow such ranges while retaining DNS answer-set validation and address-pinned transport.

## Security properties

- deny non-public addresses by default;
- require every DNS answer to be public or allowlisted;
- optionally require an exact hostname or a left-most wildcard as a second factor;
- pin each connection to the validated answer set;
- re-resolve and re-validate every same-origin redirect;
- check IPv4, IPv6, IPv4-mapped IPv6, and discovered NAT64 destinations;
- send anonymous GET requests only, with bounded URL, bytes, characters, redirects, and time;
- accept text-like content only and preserve non-2xx responses as results.

## Install into a Profile

Like DeepSeek Harness internal Host plugins, this package is a Cordis namespace plugin. Install it, then explicitly merge the published <code>cordis.patch.yml</code> into the Profile composition:

~~~bash
pnpm add dsh-web-fetch-enhanced
# merge node_modules/dsh-web-fetch-enhanced/cordis.patch.yml into the Profile patch
~~~

Then merge the required exception into <code>$DSH_HOME/profiles/&lt;profile&gt;/cordis.patch.yml</code>; do not overwrite unrelated user patches:

~~~yaml
- id: web-fetch-enhanced
  config:
    allowCidrs:
      - 198.18.0.0/15
    allowHostnames:
      - '*.example.com'
~~~

Verify the effective composition with <code>dsh --profile &lt;profile&gt; --dump-config</code>. Installing the dependency does not mutate composition automatically; explicitly merge [cordis.patch.yml](cordis.patch.yml), or use [manual.cordis.patch.yml](examples/manual.cordis.patch.yml) as a reference.

## Provider selection

The bundled [cordis.patch.yml](cordis.patch.yml) restates both existing WebRuntime fields—<code>searchProvider: deepseek-official</code> and <code>fetchProvider: http-enhanced</code>—then inserts the enhanced Host row with <code>- insert:</code>. The native <code>http</code> provider may remain because selection is explicit.

For drop-in mode, merge [drop-in.cordis.yml](examples/drop-in.cordis.yml) after the base composition patch. It fully restates the web config, disables the native provider, and sets <code>providerId: http</code>. Never register two providers with the same ID.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| <code>providerId</code> | <code>http-enhanced</code> | Fetch provider ID registered in <code>ctx.web</code> |
| <code>allowCidrs</code> | <code>[]</code> | Non-public IPv4/IPv6 CIDR exceptions |
| <code>allowHostnames</code> | <code>[]</code> | Optional exact hosts or left-most wildcard second factor |
| <code>maxResponseBytes</code> | <code>5,000,000</code> | Maximum response bytes |
| <code>maxBodyChars</code> | <code>100,000</code> | Maximum decoded characters |
| <code>timeoutMs</code> | <code>30,000</code> | Provider resource timeout |
| <code>maxRedirects</code> | <code>5</code> | Same-origin redirect limit |
| <code>userAgent</code> | <code>dsh-web-fetch-enhanced/0.1.0</code> | Request User-Agent |

Allowing a CIDR expands SSRF reachability. Pair broad fake-IP ranges with <code>allowHostnames</code> when possible. See the [Chinese security document](docs/security.zh-CN.md) and [design document](docs/design.zh-CN.md) for details.

## Development

~~~bash
pnpm install
pnpm run check
# source-mode overlay, matching internal DSH plugin development
dsh web --patch ./cordis.source.patch.yml
# rebuild the Host ESM bundle continuously
pnpm run watch
~~~

Requires Node.js <code>^22.19.0 || >=24</code>. Licensed under MIT; see [NOTICE](NOTICE) for upstream attribution.
