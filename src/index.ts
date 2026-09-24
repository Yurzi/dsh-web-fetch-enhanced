/**
 * DeepSeek Harness HTTP fetch provider with explicit non-public CIDR exceptions.
 * It preserves the native security model while making non-public exceptions explicit.
 *
 * @module dsh-web-fetch-enhanced
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { AddressPolicy } from './address-policy.ts'
import type { HttpFetchLimits } from './provider.ts'
import { EnhancedHttpFetchProvider } from './provider.ts'
import type { ProxyRouteResolver } from './resolver.ts'
import { createAllowlistResolver } from './resolver.ts'

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

/** Explicit product User-Agent used by default. */
export const DEFAULT_USER_AGENT = 'dsh-web-fetch-enhanced/0.1.0'

/** Default provider id; select it in the dsh-web row with fetchProvider. */
export const DEFAULT_PROVIDER_ID = 'http-enhanced'

/** Default Loader entry id paired with the Web Profile configuration card. */
export const SETTINGS_NAMESPACE = 'web-fetch-enhanced'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-enhanced'

/** The web seam this provider contributes to. */
export const inject = ['web']

/** Plugin configuration. Every non-public exception is explicit and deny-by-default. */
export interface ProviderConfig {
  /** Provider id registered in ctx.web. Defaults to http-enhanced. */
  providerId?: string
  /** Non-public IPv4/IPv6 CIDRs that may bypass the public-address filter. */
  allowCidrs?: readonly string[]
  /** Optional exact hosts or left-most wildcard rules required in addition to allowCidrs. */
  allowHostnames?: readonly string[]
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  maxBodyChars?: number
  /** Default fetch timeout in milliseconds, within Node's timer range. */
  timeoutMs?: number
  /** Maximum number of same-origin redirect hops to follow. */
  maxRedirects?: number
  /** User-Agent header sent on every request. */
  userAgent?: string
}

/** Keep Host-only checks out of the schema serialized for browser forms. */
function hostValidated<T>(schema: z<T>, validate: (value: T) => void): z<T> {
  const checked = z.transform(schema, (value) => {
    validate(value)
    return value
  }, true)
  // Settings strips callbacks from wire schemas. A transform without its callback
  // cannot validate even the defaults, leaving ConfigForms permanently loading.
  const presentation = new z<T>(schema.toJSON())
  checked.toJSON = function () {
    presentation.meta = { ...schema.meta, ...this.meta }
    return presentation.toJSON()
  }
  return checked
}

/** Schemastery's number bounds alone do not reject NaN; validate finiteness before commit. */
function positiveLimit(field: string, max = Number.MAX_VALUE) {
  return hostValidated(z.number().min(Number.MIN_VALUE).max(max), (value) => {
    assertPositiveFinite(field, value)
  })
}

/** Validate the whole candidate before Loader atomically commits any live references. */
export const Config = z.object({
  providerId: z.string().pattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u).default(DEFAULT_PROVIDER_ID),
  allowCidrs: hostValidated(z.array(z.string()), (value) => {
    new AddressPolicy({ allowCidrs: value })
  }).default([]).volatile(),
  allowHostnames: hostValidated(z.array(z.string()), (value) => {
    new AddressPolicy({ allowHostnames: value })
  }).default([]).volatile(),
  maxResponseBytes: positiveLimit('maxResponseBytes').default(5_000_000).volatile(),
  maxBodyChars: positiveLimit('maxBodyChars').default(100_000).volatile(),
  timeoutMs: positiveLimit('timeoutMs', MAX_NODE_TIMER_DELAY_MS).default(30_000).volatile(),
  maxRedirects: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(5).volatile(),
  userAgent: z.string().pattern(/^[\x20-\x7e\x80-\xff]*$/u).default(DEFAULT_USER_AGENT).volatile(),
})

/** Parsed plugin Config: ordinary identity plus stable live field references. */
export type Config = ReturnType<typeof Config>

interface ResolvedConfig {
  readonly providerId: string
  readonly allowCidrs: readonly string[]
  readonly allowHostnames: readonly string[]
  readonly maxResponseBytes: number
  readonly maxBodyChars: number
  readonly timeoutMs: number
  readonly maxRedirects: number
  readonly userAgent: string
}

/** Build prompt guidance copy informing the model of authorized non-public destinations. */
export function formatAllowlistPrompt(config: ProviderConfig): string {
  const cidrs = config.allowCidrs ?? []
  const hostnames = config.allowHostnames ?? []
  if (cidrs.length === 0) return ''
  const authorization = `The operator has explicitly authorized web_fetch access to non-public addresses within [CIDRs: ${cidrs.join(', ')}].`
  const restriction = hostnames.length === 0 ? ''
    : ` This exception requires BOTH an address within those CIDRs AND a URL hostname matching one of [hostnames: ${hostnames.join(', ')}]. Hostname rules only restrict the CIDR exceptions; they do not independently authorize any non-public address.`
  return `${authorization}${restriction} All other URL, DNS, redirect, and transport safety checks still apply.`
}

/** Construct the provider without mounting it, useful for tests and custom compositions. */
export function createProvider(
  config: ProviderConfig = {},
  proxyResolver?: ProxyRouteResolver,
): EnhancedHttpFetchProvider {
  const resolved = resolveConfig(config)
  assertProviderId(resolved.providerId)
  assertPositiveFinite('maxResponseBytes', resolved.maxResponseBytes)
  assertPositiveFinite('maxBodyChars', resolved.maxBodyChars)
  assertTimeoutMs(resolved.timeoutMs)
  assertNonNegativeInteger('maxRedirects', resolved.maxRedirects)
  const policy = new AddressPolicy({
    allowCidrs: resolved.allowCidrs,
    allowHostnames: resolved.allowHostnames,
  })
  const limits: HttpFetchLimits = {
    maxResponseBytes: resolved.maxResponseBytes,
    maxBodyChars: resolved.maxBodyChars,
    timeoutMs: resolved.timeoutMs,
    maxRedirects: resolved.maxRedirects,
    userAgent: resolved.userAgent,
  }
  return new EnhancedHttpFetchProvider(
    resolved.providerId,
    limits,
    createAllowlistResolver(policy),
    proxyResolver,
  )
}

export { isNonPublicIpLiteral } from './address-policy.ts'
export type { ProxyRouteResolver, ProxyRouteResult } from './resolver.ts'
export { defaultProxyRoute } from './resolver.ts'

/** Capture one coherent immutable configuration for a single request or prompt assembly. */
function snapshotConfig(config: Config): ProviderConfig {
  return {
    providerId: config.providerId,
    allowCidrs: config.allowCidrs.get(),
    allowHostnames: config.allowHostnames.get(),
    maxResponseBytes: config.maxResponseBytes.get(),
    maxBodyChars: config.maxBodyChars.get(),
    timeoutMs: config.timeoutMs.get(),
    maxRedirects: config.maxRedirects.get(),
    userAgent: config.userAgent.get(),
  }
}

/** Register a provider backed exclusively by Loader-owned live Config references. */
export function apply(ctx: Context, config: Config): void {
  // Validate before registration, including compositions that invoke apply directly.
  const providerId = createProvider(snapshotConfig(config)).id
  ctx.on('loader/volatile-update', (paths) => {
    if (paths.some(([field]) => field === 'allowCidrs' || field === 'allowHostnames')) {
      ctx.emit('system-prompt/change')
    }
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'web-fetch-enhanced:allowlist',
      order: 2105,
      text: () => formatAllowlistPrompt(snapshotConfig(config)),
      interpolate: false,
    })
  })

  const dynamicProvider: WebFetchProvider = {
    id: providerId,
    available: () => true,
    fetch: async (request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> => {
      return await createProvider(snapshotConfig(config)).fetch(request, signal)
    },
  }
  ctx.web.registerFetchProvider(dynamicProvider)
}

function resolveConfig(config: ProviderConfig): ResolvedConfig {
  return {
    providerId: config.providerId ?? DEFAULT_PROVIDER_ID,
    allowCidrs: config.allowCidrs ?? [],
    allowHostnames: config.allowHostnames ?? [],
    maxResponseBytes: config.maxResponseBytes ?? 5_000_000,
    maxBodyChars: config.maxBodyChars ?? 100_000,
    timeoutMs: config.timeoutMs ?? 30_000,
    maxRedirects: config.maxRedirects ?? 5,
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
  }
}

function assertProviderId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error('web-fetch-enhanced: providerId must be 1-128 letters, digits, dots, underscores, or hyphens')
  }
}

function assertPositiveFinite(field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`web-fetch-enhanced: ${field} must be a positive finite number`)
  }
}

function assertTimeoutMs(value: number): void {
  assertPositiveFinite('timeoutMs', value)
  if (value > MAX_NODE_TIMER_DELAY_MS) {
    throw new Error(`web-fetch-enhanced: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`)
  }
}

function assertNonNegativeInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`web-fetch-enhanced: ${field} must be a non-negative integer`)
  }
}
