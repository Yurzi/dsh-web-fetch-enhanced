/**
 * The local provider: fetch directly from this machine with DSH's official
 * HTTP transport, widening only its destination check. URL policy, redirects,
 * proxy routing, connection pinning, timeouts, and size limits are the
 * official `HttpFetchProvider`'s; this module supplies the resolver that
 * admits the operator's non-public exceptions.
 */
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import { HttpFetchProvider, type HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import { AddressPolicy, type AllowlistRules } from './address-policy.ts'
import { resolveAllowedAddresses } from './resolver.ts'

export { AddressPolicy, isPublicAddress, type AllowlistRules } from './address-policy.ts'

/** Everything one local fetch reads, snapshotted when the request starts. */
export interface LocalFetchSettings extends HttpFetchLimits, AllowlistRules {}

/**
 * @param read - returns the settings for the next request; called once per request.
 * @returns a provider that never sends a URL anywhere but its own destination.
 */
export function createLocalProvider(read: () => LocalFetchSettings): WebFetchProvider {
  return {
    id: 'local',
    available: () => true,
    fetch(request, signal) {
      const settings = read()
      const policy = new AddressPolicy(settings)
      const resolve = (hostname: string, abort: AbortSignal) => resolveAllowedAddresses(hostname, abort, policy)
      return new HttpFetchProvider(settings, resolve).fetch(request, signal)
    },
  }
}
