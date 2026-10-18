/**
 * DeepSeek Harness `web_fetch` with operator-approved non-public
 * destinations. The plugin takes the native fetch provider's seat in
 * `ctx.web`, keeps every native safety check, and lets the operator open
 * specific CIDRs — for example a Clash/Mihomo fake-IP range or an intranet
 * documentation site — optionally narrowed to named hostnames.
 * @module dsh-web-fetch-enhanced
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import { Config, readSettings } from './config.ts'
import { createFetchService } from './providers/index.ts'
import { registerAllowlistNotice } from './prompt.ts'

export { Config } from './config.ts'
export { CONFIG_SCHEMA_VERSION, migrateConfig } from './config-migrations.ts'
export { DEFAULT_PROVIDER_ID } from './contract.ts'
export type { FetchSettings } from './providers/index.ts'

/** Cordis plugin name used in Loader diagnostics. */
export const name = 'web-fetch-enhanced'

/** The capability seam this plugin contributes to. */
export const inject = ['web']

/**
 * Register the fetch provider and, while it serves `web_fetch`, the
 * allowlist note for the model.
 * @param ctx - plugin context; both registrations leave with its fiber.
 * @param config - the Loader-owned live configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const read = () => readSettings(config)
  ctx.web.registerFetchProvider(createFetchService(config.providerId, read))
  registerAllowlistNotice(ctx, config.providerId, read)
}

/**
 * Build the provider outside a Loader-managed composition, for example in a
 * custom Host or a script.
 * @param input - raw configuration in any supported format.
 * @returns a provider with a fixed configuration snapshot.
 */
export function createProvider(input: unknown = {}): WebFetchProvider {
  const config = Config(input)
  return createFetchService(config.providerId, () => readSettings(config))
}
