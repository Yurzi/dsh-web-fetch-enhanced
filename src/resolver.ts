import { lookup as systemLookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import type { Response } from 'undici'
import { WebError } from '@deepseek-ai/dsh-web'
import { AddressPolicy, stripIpv6Brackets } from './address-policy.ts'

/** DNS resolver shape used by Node and by focused tests. */
export type AddressResolver = (
  hostname: string,
  options: { all: true; order: 'verbatim' },
) => Promise<LookupAddress[]>

/** One validated address that the pinned transport may connect to. */
export interface ValidatedAddress {
  readonly address: string
  readonly family: 4 | 6
}

/** Resolver accepted by the enhanced fetch provider. */
export type FetchResolver = (hostname: string, signal: AbortSignal) => Promise<ValidatedAddress[]>

/** A response and the disposer for its request-local dispatcher. */
export interface PinnedResponse {
  readonly response: Response
  close(): Promise<void>
}

const RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96] as const
const IPV4ONLY_DISCOVERY_HOST = 'ipv4only.arpa'
const IPV4ONLY_SENTINELS = new Set(['192.0.0.170', '192.0.0.171'])

interface Nat64Prefix {
  readonly bytes: readonly number[]
  readonly length: typeof RFC6052_PREFIX_LENGTHS[number]
}

/** Build the resolver injected into the address-pinned HTTP provider. */
export function createAllowlistResolver(
  policy: AddressPolicy,
  resolver: AddressResolver = systemLookup,
): FetchResolver {
  return (hostname, signal) => resolveAllowedAddresses(hostname, signal, policy, resolver)
}

/** Resolve once and reject the complete answer set when any entry is disallowed. */
export async function resolveAllowedAddresses(
  hostname: string,
  signal: AbortSignal,
  policy: AddressPolicy,
  resolver: AddressResolver = systemLookup,
): Promise<ValidatedAddress[]> {
  const unbracketed = stripIpv6Brackets(hostname)
  const literalFamily = isIP(unbracketed)
  const resolved = literalFamily === 0
    ? await raceWithSignal(resolver(unbracketed, { all: true, order: 'verbatim' }), signal)
    : [{ address: unbracketed, family: literalFamily }]

  if (resolved.length === 0) {
    throw new WebError(`hostname "${hostname}" resolved to no addresses`, 'WEB_PROVIDER_ERROR')
  }

  const hasIpv6 = resolved.some(entry => entry.family === 6 && isIP(entry.address) === 6)
  const nat64Prefixes = hasIpv6 ? await discoverNat64Prefixes(signal, resolver) : []
  const addresses: ValidatedAddress[] = []

  for (const entry of resolved) {
    if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) {
      throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, 'WEB_PROVIDER_ERROR')
    }
    if (!policy.allows(hostname, entry.address)) {
      throw new WebError(
        `URL hostname "${hostname}" resolves to non-public IP address "${entry.address}" outside the configured allowlist`,
        'WEB_BLOCKED_URL',
      )
    }
    for (const translatedIpv4 of translatedIpv4Addresses(entry.address, nat64Prefixes)) {
      if (!policy.allows(hostname, translatedIpv4)) {
        throw new WebError(
          `URL hostname "${hostname}" resolves through NAT64 to non-public IPv4 address "${translatedIpv4}" outside the configured allowlist`,
          'WEB_BLOCKED_URL',
        )
      }
    }
    addresses.push({ address: entry.address, family: entry.family })
  }

  return addresses
}

async function discoverNat64Prefixes(signal: AbortSignal, resolver: AddressResolver): Promise<Nat64Prefix[]> {
  const discovered = await raceWithSignal(
    resolver(IPV4ONLY_DISCOVERY_HOST, { all: true, order: 'verbatim' }),
    signal,
  )
  const prefixes: Nat64Prefix[] = []
  const seen = new Set<string>()
  for (const entry of discovered) {
    if (entry.family !== 6 || isIP(entry.address) !== 6) continue
    const bytes = ipaddr.parse(entry.address).toByteArray()
    for (const length of RFC6052_PREFIX_LENGTHS) {
      const embedded = embeddedIpv4Address(bytes, length)
      if (embedded === undefined || !IPV4ONLY_SENTINELS.has(embedded)) continue
      const prefixBytes = bytes.slice(0, length / 8)
      const key = `${String(length)}:${prefixBytes.join('.')}`
      if (seen.has(key)) continue
      seen.add(key)
      prefixes.push({ bytes: prefixBytes, length })
    }
  }
  return prefixes
}

function translatedIpv4Addresses(input: string, prefixes: readonly Nat64Prefix[]): string[] {
  if (isIP(input) !== 6) return []
  const bytes = ipaddr.parse(input).toByteArray()
  const translated: string[] = []
  const seen = new Set<string>()
  for (const prefix of prefixes) {
    if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue
    const embedded = embeddedIpv4Address(bytes, prefix.length)
    if (embedded === undefined || seen.has(embedded)) continue
    seen.add(embedded)
    translated.push(embedded)
  }
  return translated
}

function embeddedIpv4Address(
  bytes: readonly number[],
  prefixLength: Nat64Prefix['length'],
): string | undefined {
  if (prefixLength === 96) return bytes.slice(12, 16).join('.')
  if (bytes[8] !== 0) return undefined
  const prefixBytes = prefixLength / 8
  const beforeReservedOctet = 8 - prefixBytes
  return [
    ...bytes.slice(prefixBytes, prefixBytes + beforeReservedOctet),
    ...bytes.slice(9, 9 + 4 - beforeReservedOctet),
  ].join('.')
}

/** Fetch while preserving the URL hostname for Host and TLS SNI. */
export async function requestPinned(
  url: URL,
  addresses: readonly ValidatedAddress[],
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  const { Agent, fetch } = await import('undici')
  const dispatcher = new Agent({
    autoSelectFamily: true,
    connect: { lookup: createPinnedLookup(addresses) },
  })
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', headers, signal, dispatcher })
    return { response, close: async () => { await dispatcher.close() } }
  } catch (error: unknown) {
    await dispatcher.close()
    throw error
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/** Create a Node lookup callback that returns only the prevalidated answer set. */
export function createPinnedLookup(addresses: readonly ValidatedAddress[]): (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    const family = typeof options.family === 'number'
      ? options.family
      : options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : 0
    const eligible = family === 0 ? addresses : addresses.filter(address => address.family === family)
    const selected = eligible[0]
    if (selected === undefined) {
      const error = Object.assign(new Error(`no validated address for ${hostname} in family ${family}`), {
        code: 'ENOTFOUND',
        hostname,
      })
      callback(error, options.all === true ? [] : '', family)
      return
    }
    if (options.all === true) {
      callback(null, eligible.map(address => ({ ...address })))
      return
    }
    callback(null, selected.address, selected.family)
  }
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = () => new Error('web fetch aborted during hostname resolution', { cause: signal.reason })
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const abort = () => { reject(abortError()) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}
