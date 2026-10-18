/**
 * The plugin row's configuration. Every field but the provider identity is
 * volatile: Settings edits it live, the Loader validates the whole candidate
 * before committing any field, and each request reads one consistent snapshot.
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_USER_AGENT } from '@deepseek-ai/dsh-web-fetch-http'
import { CONFIG_SCHEMA_VERSION, withConfigMigrations } from './config-migrations.ts'
import { DEFAULT_PROVIDER_ID, MAX_TIMER_DELAY_MS, PROVIDER_ID_PATTERN, USER_AGENT_PATTERN } from './contract.ts'
import { AddressPolicy } from './providers/local/index.ts'
import type { FetchSettings } from './providers/index.ts'

/**
 * Validate with `check` on the Host while serializing as the plain inner
 * schema. Settings strips callbacks from the schema it sends to browsers; a
 * transform without its callback would fail every browser-side decode and
 * leave the form loading forever. The settings page runs the same rules
 * itself, so the browser loses no feedback.
 */
function hostChecked<T>(schema: z<T>, check: (value: T) => void): z<T> {
  const checked = z.transform(schema, (value) => {
    check(value)
    return value
  }, true)
  const wire = new z<T>(schema.toJSON())
  checked.toJSON = function () {
    wire.meta = { ...schema.meta, ...this.meta }
    return wire.toJSON()
  }
  return checked
}

const positiveInteger = () => z.natural().min(1)

export const Config = withConfigMigrations(z.object({
  schemaVersion: z.const(CONFIG_SCHEMA_VERSION).default(CONFIG_SCHEMA_VERSION)
    .description('Configuration format version.'),
  providerId: z.string().pattern(PROVIDER_ID_PATTERN).default(DEFAULT_PROVIDER_ID)
    .description('Provider id registered in ctx.web; web.fetchProvider selects it.'),
  allowCidrs: hostChecked(z.array(z.string()), allowCidrs => new AddressPolicy({ allowCidrs, allowHostnames: [] }))
    .default([]).volatile().description('Non-public IPv4/IPv6 CIDRs web_fetch may reach.'),
  allowHostnames: hostChecked(z.array(z.string()), allowHostnames => new AddressPolicy({ allowCidrs: [], allowHostnames }))
    .default([]).volatile().description('When set, only these hostnames may use the CIDR exceptions.'),
  userAgent: z.string().pattern(USER_AGENT_PATTERN).default(DEFAULT_USER_AGENT).volatile()
    .description('User-Agent header sent on every request; empty sends an empty header.'),
  maxResponseBytes: positiveInteger().default(5_000_000).volatile().description('Response bytes read at most.'),
  maxBodyChars: positiveInteger().default(100_000).volatile().description('Decoded characters returned at most.'),
  timeoutMs: positiveInteger().max(MAX_TIMER_DELAY_MS).default(30_000).volatile().description('Timeout per fetch, in milliseconds.'),
  maxRedirects: z.natural().default(5).volatile().description('Same-origin redirects followed at most.'),
}))

/** Parsed configuration: plain identity fields and live references for the rest. */
export type Config = ReturnType<typeof Config>

/**
 * Capture one consistent snapshot of the live fields for a single request.
 * @param config - the Loader-owned parsed configuration.
 * @returns plain values every provider reads.
 */
export function readSettings(config: Config): FetchSettings {
  return {
    allowCidrs: config.allowCidrs.get(),
    allowHostnames: config.allowHostnames.get(),
    userAgent: config.userAgent.get(),
    maxResponseBytes: config.maxResponseBytes.get(),
    maxBodyChars: config.maxBodyChars.get(),
    timeoutMs: config.timeoutMs.get(),
    maxRedirects: config.maxRedirects.get(),
  }
}
