/**
 * DeepSeek Harness HTTP fetch provider with explicit non-public CIDR exceptions.
 * It preserves the native security model while making non-public exceptions explicit.
 *
 * @module dsh-web-fetch-enhanced
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { AddressPolicy } from './address-policy.ts'
import type { HttpFetchLimits } from './provider.ts'
import { EnhancedHttpFetchProvider } from './provider.ts'
import { createAllowlistResolver } from './resolver.ts'

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

/** Explicit product User-Agent used by default. */
export const DEFAULT_USER_AGENT = 'dsh-web-fetch-enhanced/0.1.0'

/** Default provider id; select it in the dsh-web row with fetchProvider. */
export const DEFAULT_PROVIDER_ID = 'http-enhanced'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-enhanced'

/** The web seam this provider contributes to. */
export const inject = ['web']

/** Plugin configuration. Every non-public exception is explicit and deny-by-default. */
export interface Config {
  /** Provider id registered in ctx.web. Defaults to http-enhanced. */
  providerId?: string
  /** Non-public IPv4/IPv6 CIDRs that may bypass the public-address filter. */
  allowCidrs?: string[]
  /** Optional exact hosts or left-most wildcard rules required in addition to allowCidrs. */
  allowHostnames?: string[]
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

export const Config: z<Config> = z.object({
  providerId: z.string().default(DEFAULT_PROVIDER_ID),
  allowCidrs: z.array(z.string()).default([]),
  allowHostnames: z.array(z.string()).default([]),
  maxResponseBytes: z.number().default(5_000_000),
  maxBodyChars: z.number().default(100_000),
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
})

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

/** Construct the provider without mounting it, useful for tests and custom compositions. */
export function createProvider(config: Config = {}): EnhancedHttpFetchProvider {
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
  )
}

/** Register the enhanced fetch provider with ctx.web. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerFetchProvider(createProvider(config))
}

function resolveConfig(config: Config): ResolvedConfig {
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
