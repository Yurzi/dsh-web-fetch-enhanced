/**
 * The local provider: fetch directly from this machine with DSH's official
 * HTTP transport, widening only its destination check. URL policy, redirects,
 * proxy routing, connection pinning, timeouts, and size limits are the
 * official `HttpFetchProvider`'s; this module supplies the resolver that
 * admits the operator's non-public exceptions.
 */
import { isIP } from 'node:net'
import { WebError, type WebFetchProvider } from '@deepseek-ai/dsh-web'
import { HttpFetchProvider, type HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import { AddressPolicy, type AllowlistRules } from './address-policy.ts'
import { resolveAllowedAddresses } from './resolver.ts'
import { stripIpv6Brackets } from './rules.ts'

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
    async fetch(request, signal) {
      const settings = read()
      const policy = new AddressPolicy(settings)
      assertLiteralAllowed(request.url, policy)
      const resolve = (hostname: string, abort: AbortSignal) => resolveAllowedAddresses(hostname, abort, policy)
      return await new HttpFetchProvider(settings, resolve).fetch(request, signal)
    },
  }
}

/**
 * Refuse a disallowed IP literal before the official transport sees it. That
 * transport hands IP literals it classifies as public straight to a
 * configured proxy without calling the resolver, and its classifier reads
 * IPv4-compatible IPv6 such as `[::7f00:1]` as public. Redirects are followed
 * only within one origin, so the request URL's host is every hop's host.
 * @param url - the requested URL; an unparseable one is left to the transport to reject.
 * @param policy - the allowlist in force.
 */
function assertLiteralAllowed(url: string, policy: AddressPolicy): void {
  const hostname = URL.parse(url)?.hostname
  if (hostname === undefined || isIP(stripIpv6Brackets(hostname)) === 0 || policy.allows(hostname, hostname)) return
  throw new WebError(`URL host "${hostname}" is a non-public IP address outside the configured allowlist`, 'WEB_BLOCKED_URL')
}
