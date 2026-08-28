# Contributing

## Development setup

Requirements: Node.js ^22.19.0 or >=24 and pnpm 11.7.0.

~~~bash
pnpm install
pnpm run check
~~~

## Change requirements

Changes to address classification, DNS, redirect, transport, timeout, MIME, or
allowlist behavior are security-sensitive. A pull request must include:

1. the threat or routing use case;
2. default-deny behavior when the new option is omitted;
3. focused positive and negative tests;
4. a mixed-answer or rebinding analysis when DNS behavior changes;
5. documentation updates for operator-visible behavior.

Do not add credentials, arbitrary headers, model-controlled allowlists, ambient
proxy authentication, cross-origin redirects, or subresource loading to this
provider. Those capabilities require a separate trust and approval design.

## Release check

~~~bash
pnpm run typecheck
pnpm run test:coverage
pnpm run build
pnpm exec publint
pnpm pack --dry-run
~~~

The package is a Cordis namespace plugin and must not gain a default export.
