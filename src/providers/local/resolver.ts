/**
 * DNS resolution for the local provider. One answer set is resolved and
 * validated in full; the official transport then pins its connection to
 * exactly these addresses, so the hostname is never resolved again between
 * the check and the connection.
 */
import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { WebError } from '@deepseek-ai/dsh-web'
import type { AddressPolicy } from './address-policy.ts'
import { stripIpv6Brackets } from './rules.ts'

/** Lookup signature of `node:dns/promises`, replaceable in tests. */
export type AddressLookup = (hostname: string, options: { all: true; order: 'verbatim' }) => Promise<LookupAddress[]>

/** One validated destination the transport may connect to. */
export interface ValidatedAddress {
  readonly address: string
  readonly family: 4 | 6
}

/** RFC 6052 prefix lengths that can carry an IPv4 destination through NAT64. */
const RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96] as const
/** RFC 7050 discovery name and the IPv4 answers it embeds. */
const IPV4ONLY_ARPA = 'ipv4only.arpa'
const IPV4ONLY_SENTINELS = new Set(['192.0.0.170', '192.0.0.171'])

interface Nat64Prefix {
  readonly bytes: readonly number[]
  readonly length: typeof RFC6052_PREFIX_LENGTHS[number]
}

/**
 * Resolve a hostname once and refuse the whole answer set if any address, or
 * the IPv4 address it reaches through an active NAT64 prefix, is not allowed.
 * @param hostname - URL hostname; IP literals are checked without DNS.
 * @param signal - stops waiting for resolution.
 * @param policy - the allowlist in force for this request.
 * @param resolve - lookup implementation.
 * @returns the complete, validated answer set.
 */
export async function resolveAllowedAddresses(
  hostname: string,
  signal: AbortSignal,
  policy: AddressPolicy,
  resolve: AddressLookup = lookup,
): Promise<ValidatedAddress[]> {
  const bare = stripIpv6Brackets(hostname)
  const literal = isIP(bare)
  const answers = literal === 0
    ? await raceWithSignal(resolve(bare, { all: true, order: 'verbatim' }), signal)
    : [{ address: bare, family: literal }]
  if (answers.length === 0) {
    throw new WebError(`hostname "${hostname}" resolved to no addresses`, 'WEB_PROVIDER_ERROR')
  }

  const nat64 = answers.some(answer => answer.family === 6) ? await discoverNat64Prefixes(signal, resolve) : []
  return answers.map(({ address, family }) => {
    if ((family !== 4 && family !== 6) || isIP(address) !== family) {
      throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, 'WEB_PROVIDER_ERROR')
    }
    if (!policy.allows(hostname, address)) {
      throw new WebError(
        `URL hostname "${hostname}" resolves to non-public IP address "${address}" outside the configured allowlist`,
        'WEB_BLOCKED_URL',
      )
    }
    for (const translated of embeddedIpv4Addresses(address, nat64)) {
      if (!policy.allows(hostname, translated)) {
        throw new WebError(
          `URL hostname "${hostname}" resolves through NAT64 to non-public IPv4 address "${translated}" outside the configured allowlist`,
          'WEB_BLOCKED_URL',
        )
      }
    }
    return { address, family }
  })
}

/** Discover active DNS64 prefixes (RFC 7050). */
async function discoverNat64Prefixes(signal: AbortSignal, resolve: AddressLookup): Promise<Nat64Prefix[]> {
  const answers = await raceWithSignal(resolve(IPV4ONLY_ARPA, { all: true, order: 'verbatim' }), signal)
  const prefixes = new Map<string, Nat64Prefix>()
  for (const answer of answers) {
    if (answer.family !== 6) continue
    const bytes = ipaddr.parse(answer.address).toByteArray()
    for (const length of RFC6052_PREFIX_LENGTHS) {
      if (!IPV4ONLY_SENTINELS.has(embeddedIpv4(bytes, length) ?? '')) continue
      const prefix = bytes.slice(0, length / 8)
      prefixes.set(`${length}:${prefix.join('.')}`, { bytes: prefix, length })
    }
  }
  return [...prefixes.values()]
}

/**
 * Every IPv4 address an IPv6 answer reaches through a discovered prefix.
 * Overlapping prefixes are all checked: the translator, not answer order,
 * decides which one applies.
 */
function embeddedIpv4Addresses(address: string, prefixes: readonly Nat64Prefix[]): Set<string> {
  const found = new Set<string>()
  if (isIP(address) !== 6) return found
  const bytes = ipaddr.parse(address).toByteArray()
  for (const prefix of prefixes) {
    if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue
    const embedded = embeddedIpv4(bytes, prefix.length)
    if (embedded !== undefined) found.add(embedded)
  }
  return found
}

/** Extract the IPv4 address an RFC 6052 layout embeds, skipping the reserved octet. */
function embeddedIpv4(bytes: readonly number[], prefixLength: Nat64Prefix['length']): string | undefined {
  if (prefixLength === 96) return bytes.slice(12, 16).join('.')
  if (bytes[8] !== 0) return undefined
  const start = prefixLength / 8
  const beforeReserved = 8 - start
  return [...bytes.slice(start, 8), ...bytes.slice(9, 9 + 4 - beforeReserved)].join('.')
}

/** Stop waiting for a non-cancellable OS lookup when the request is cancelled. */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const aborted = () => new Error('web fetch aborted during hostname resolution', { cause: signal.reason })
  if (signal.aborted) return Promise.reject(aborted())
  return new Promise<T>((resolve, reject) => {
    const abort = () => { reject(aborted()) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}
