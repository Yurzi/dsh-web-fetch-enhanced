# AGENTS.md

DeepSeek Harness (DSH) plugin `dsh-web-fetch-enhanced`: lets `web_fetch` reach operator-approved non-public addresses (fake-IP ranges, intranet docs). It takes the native fetch provider's seat (`providerId: http`) and delegates transport to the official `HttpFetchProvider` from `@deepseek-ai/dsh-web-fetch-http`, injecting its own allowlist-aware DNS resolver. Requires DSH `>=0.2.1-rc.2 <0.3.0-0`. Docs are Chinese-first; README.en.md mirrors README.md.

## Layout

- `src/index.ts` – namespace plugin entry (`name`, `inject`, `Config`, `apply`, `createProvider`).
- `src/contract.ts` – names and value rules shared by Host and browser.
- `src/config.ts`, `src/config-migrations.ts` – schema (volatile fields, `hostChecked`), per-request snapshot, `schemaVersion` migrations.
- `src/prompt.ts` – runtime context telling the model which ranges are open.
- `src/providers/index.ts` – the single `ctx.web` seat; picks a backend per request.
- `src/providers/local/` – local backend: `index.ts` (literal check + official transport), `rules.ts` (allowlist grammar), `address-policy.ts`, `resolver.ts` (answer-set validation, NAT64).
- `src/client/` – browser face: Plugins-page settings (`settings-page.ts` controller, `SettingsPage.tsx`, `allowlist-lines.ts`, `locales.ts`, `style.css`).
- `cordis.patch.yml` – bundle patch: disable `web-fetch-http`, insert the plugin row.
- `tests/` – vitest specs; `tests/support/primitives.tsx` stands in for the shell's UI primitives.
- `docs/` – architecture, configuration, security, providers roadmap.

## Commands

- `pnpm install`
- `pnpm run check` – typecheck, type-aware oxlint, tsdown build, vitest, publint. Must pass.
- `pnpm run dev` – watch build; install with `dsh plugin --profile <p> add link:<abs path>`, HMR reloads on `lib` changes.
- `pnpm run test:coverage` – coverage floor (lines 85, branches 75).

## Invariants

- Security defaults: with empty `allowCidrs` behavior equals the native public-only provider. Never widen reachability by default; never let the model control allowlists, headers, method, or proxy.
- The whole DNS answer set is validated; one bad answer refuses the request. Validated addresses are what the connection uses.
- Never patch the shared `web` row (or any other shared row) in `cordis.patch.yml`: patches replace a row's whole config and drop the other field, causing `WEB_PROVIDER_AMBIGUOUS` on DSH 0.2.1.
- Exactly one provider registered in `ctx.web`. New fetch methods are backends behind `createFetchService`, selected by a volatile field; see `docs/providers.zh-CN.md`. Remote backends must refuse non-public / allowlist-only / fake-IP URLs before any outbound request and use global `fetch` (no private Undici agents).
- Do not reimplement the transport; reuse `HttpFetchProvider`.
- Namespace plugin: no default export. Relative imports carry `.ts`.
- Browser code may runtime-import only platform modules (React, `react/jsx-runtime`, `@deepseek-ai/*`); everything else is type-only or bundled (ipaddr.js).
- `rules.ts` and `contract.ts` stay isomorphic: no Node built-ins, no Host packages.
- New config fields are optional with defaults (no `schemaVersion` bump). Bump only when an existing field changes meaning; explicit `[]` must survive migrations.
- Tests exercise behavior at seams (Loader composition, real official transport, local HTTP servers, real patch semantics, page driven like a user). No tests of private details, no defensive filler.

## Verify

1. `pnpm run check` (and `pnpm run test:coverage` for releases).
2. Optional: isolated end-to-end run in a throwaway `DSH_HOME` — install the packed tarball, check `dsh --profile web --dump-config` (native row disabled, `web` row has both `searchProvider` and `fetchProvider`), confirm loopback is refused until allowed, `web_search` is not ambiguous, and the Plugins page renders. Never touch the user's running DSH or real Profiles.

## Docs map

- `README.md` / `README.en.md` – users: install, configure, FAQ.
- `docs/configuration.zh-CN.md` – fields, empty vs reset, YAML, provider selection, format versions.
- `docs/architecture.zh-CN.md` – modules, data flow, composition, lifecycle, browser face, error codes.
- `docs/security.zh-CN.md` – threat model, responsibilities, checklists.
- `docs/providers.zh-CN.md` – backend seam, roadmap, disclosure/egress/credential/fallback rules.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `NOTICE`.

Keep docs in sync with code: when behavior changes, update README (both languages), the relevant doc, and CHANGELOG.
