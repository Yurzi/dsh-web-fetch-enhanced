import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'

type IpAddress = ipaddr.IPv4 | ipaddr.IPv6

interface CompiledCidr {
  readonly network: IpAddress
  readonly prefixLength: number
}

interface ExactHostname {
  readonly kind: 'exact'
  readonly hostname: string
}

interface SuffixHostname {
  readonly kind: 'suffix'
  readonly suffix: string
}

type CompiledHostname = ExactHostname | SuffixHostname

/** Inputs used to compile the non-public destination allowlist. */
export interface AddressPolicyOptions {
  /** IPv4 and IPv6 CIDRs allowed as exceptions to the public-address rule. */
  readonly allowCidrs?: readonly string[]
  /** Optional exact hostnames or left-most wildcards that must also match an exception. */
  readonly allowHostnames?: readonly string[]
}

/**
 * Immutable address policy. Public unicast remains allowed. A non-public address
 * must match one configured CIDR and, when hostname rules exist, one hostname rule.
 */
export class AddressPolicy {
  readonly #cidrs: readonly CompiledCidr[]
  readonly #hostnames: readonly CompiledHostname[]

  constructor(options: AddressPolicyOptions = {}) {
    this.#cidrs = (options.allowCidrs ?? []).map(compileCidr)
    this.#hostnames = (options.allowHostnames ?? []).map(compileHostname)
  }

  /** Return true when an address is public or explicitly exempted for this hostname. */
  allows(hostname: string, address: string): boolean {
    const parsed = parseAddress(address)
    if (parsed === undefined) return false
    if (isPublicAddress(parsed)) return true
    if (!this.#matchesHostname(hostname)) return false
    return this.#cidrs.some(cidr => matchesCidr(parsed, cidr))
  }

  /** Return true only when a non-public address is covered by the configured exception. */
  allowsNonPublic(hostname: string, address: string): boolean {
    const parsed = parseAddress(address)
    if (parsed === undefined || isPublicAddress(parsed)) return false
    return this.#matchesHostname(hostname) && this.#cidrs.some(cidr => matchesCidr(parsed, cidr))
  }

  #matchesHostname(hostname: string): boolean {
    if (this.#hostnames.length === 0) return true
    const normalized = normalizeHostname(hostname)
    return this.#hostnames.some((rule) => {
      if (rule.kind === 'exact') return normalized === rule.hostname
      return normalized.endsWith(rule.suffix) && normalized.length > rule.suffix.length
    })
  }
}

/** Return true only for globally reachable unicast, matching the native provider. */
export function isPublicIpAddress(input: string): boolean {
  const parsed = parseAddress(input)
  return parsed !== undefined && isPublicAddress(parsed)
}

function isPublicAddress(address: IpAddress): boolean {
  return address.range() === 'unicast'
}

function parseAddress(input: string): IpAddress | undefined {
  try {
    const parsed = ipaddr.parse(stripIpv6Brackets(input))
    if (parsed instanceof ipaddr.IPv6) {
      if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address()
      const bytes = parsed.toByteArray()
      if (bytes.slice(0, 12).every(byte => byte === 0)) {
        return new ipaddr.IPv4(bytes.slice(12))
      }
    }
    return parsed
  } catch {
    return undefined
  }
}

function compileCidr(input: string): CompiledCidr {
  const source = input.trim()
  if (source.length === 0) throw new Error('web-fetch-enhanced: allowCidrs must not contain an empty value')
  const parts = source.split('/')
  const addressText = parts[0]
  const prefixText = parts[1]
  if (parts.length !== 2 || addressText === undefined || prefixText === undefined || !/^(0|[1-9]\d*)$/u.test(prefixText)) {
    throw new Error(`web-fetch-enhanced: invalid CIDR ${JSON.stringify(input)}`)
  }
  let parsed: [IpAddress, number]
  try {
    parsed = ipaddr.parseCIDR(source)
  } catch (error: unknown) {
    throw new Error(`web-fetch-enhanced: invalid CIDR ${JSON.stringify(input)}`, { cause: error })
  }
  const [network, prefixLength] = parsed
  if (network instanceof ipaddr.IPv4 && !isStrictIpv4Literal(addressText)) {
    throw new Error(`web-fetch-enhanced: IPv4 CIDR must use four decimal octets: ${JSON.stringify(input)}`)
  }
  if (network instanceof ipaddr.IPv6 && addressText.includes('%')) {
    throw new Error(`web-fetch-enhanced: IPv6 CIDR must not contain a zone id: ${JSON.stringify(input)}`)
  }
  if (network instanceof ipaddr.IPv6 && network.isIPv4MappedAddress()) {
    throw new Error(`web-fetch-enhanced: IPv4-mapped CIDR ${JSON.stringify(input)} is ambiguous; use its IPv4 CIDR`)
  }
  const base = network instanceof ipaddr.IPv4
    ? ipaddr.IPv4.networkAddressFromCIDR(source)
    : ipaddr.IPv6.networkAddressFromCIDR(source)
  if (!network.toByteArray().every((byte, index) => base.toByteArray()[index] === byte)) {
    throw new Error(`web-fetch-enhanced: CIDR must use its network base address: ${JSON.stringify(input)}`)
  }
  return { network, prefixLength }
}

function isStrictIpv4Literal(input: string): boolean {
  const octets = input.split('.')
  return octets.length === 4 && octets.every((octet) => {
    if (!/^(0|[1-9]\d{0,2})$/u.test(octet)) return false
    return Number(octet) <= 255
  })
}

function matchesCidr(address: IpAddress, cidr: CompiledCidr): boolean {
  if (address.kind() !== cidr.network.kind()) return false
  return address.match(cidr.network, cidr.prefixLength)
}

function compileHostname(input: string): CompiledHostname {
  const source = input.trim()
  if (source.startsWith('*.')) {
    const base = source.slice(2)
    if (base.length === 0 || isIP(stripIpv6Brackets(base)) !== 0) {
      throw new Error(`web-fetch-enhanced: invalid wildcard hostname ${JSON.stringify(input)}`)
    }
    return { kind: 'suffix', suffix: `.${normalizeHostname(base)}` }
  }
  if (source.includes('*')) {
    throw new Error(`web-fetch-enhanced: hostname wildcard is only allowed as the left-most "*." label: ${JSON.stringify(input)}`)
  }
  return { kind: 'exact', hostname: normalizeHostname(source) }
}

function normalizeHostname(input: string): string {
  const source = stripIpv6Brackets(input.trim()).replace(/\.$/u, '')
  if (source.length === 0 || /[\\\s/?#@]/u.test(source)) {
    throw new Error(`web-fetch-enhanced: invalid hostname ${JSON.stringify(input)}`)
  }
  if (isIP(source) !== 0) return ipaddr.parse(source).toString().toLowerCase()
  if (source.includes(':')) {
    throw new Error(`web-fetch-enhanced: hostname rules must not include a port: ${JSON.stringify(input)}`)
  }
  const parsed = new URL(`http://${source}/`)
  if (parsed.hostname === '') {
    throw new Error(`web-fetch-enhanced: invalid hostname ${JSON.stringify(input)}`)
  }
  return parsed.hostname.replace(/\.$/u, '').toLowerCase()
}

/** WHATWG URL retains brackets around IPv6 hostnames; IP parsers do not. */
export function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}
