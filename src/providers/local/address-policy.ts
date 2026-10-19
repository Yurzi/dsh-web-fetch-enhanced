import ipaddr from 'ipaddr.js'
import {
  type Cidr, type HostnameRule, type IpAddress, type ParseResult, type RuleProblem,
  matchesCidr, normalizeHost, parseCidr, parseHostnameRule, stripIpv6Brackets,
} from './rules.ts'

/** The operator's exceptions to the public-only destination rule. */
export interface AllowlistRules {
  /** Non-public IPv4/IPv6 CIDRs that may be reached. */
  readonly allowCidrs: readonly string[]
  /** When non-empty, only these hostnames may use the CIDR exceptions. */
  readonly allowHostnames: readonly string[]
}

/**
 * Decides whether a resolved address may be connected to. Public unicast is
 * always allowed, exactly like the native provider. A non-public address must
 * fall inside a configured CIDR and, when hostname rules exist, belong to a
 * URL whose hostname matches one of them.
 */
export class AddressPolicy {
  readonly #cidrs: readonly Cidr[]
  readonly #hostnames: readonly HostnameRule[]

  /**
   * @param rules - the configured exceptions.
   * @throws Error naming the first refused rule.
   */
  constructor(rules: AllowlistRules) {
    this.#cidrs = rules.allowCidrs.map(rule => accept('allowCidrs', rule, parseCidr(rule)))
    this.#hostnames = rules.allowHostnames.map(rule => accept('allowHostnames', rule, parseHostnameRule(rule)))
  }

  /**
   * @param hostname - the request URL's hostname.
   * @param address - one resolved destination address.
   * @returns whether a connection to `address` is allowed for this URL.
   */
  allows(hostname: string, address: string): boolean {
    const parsed = parseAddress(address)
    if (parsed === undefined) return false
    if (parsed.range() === 'unicast') return true
    return this.#matchesHostname(hostname) && this.#cidrs.some(cidr => matchesCidr(parsed, cidr))
  }

  #matchesHostname(hostname: string): boolean {
    if (this.#hostnames.length === 0) return true
    const host = normalizeHost(hostname)
    return this.#hostnames.some(rule => rule.kind === 'exact'
      ? host === rule.hostname
      : host.endsWith(rule.suffix) && host.length > rule.suffix.length)
  }
}

/**
 * Whether an address is globally reachable unicast. IPv4-mapped and
 * IPv4-compatible IPv6 are judged by the IPv4 address they embed.
 * @param address - textual IPv4 or IPv6, brackets allowed.
 * @returns true only for a public destination.
 */
export function isPublicAddress(address: string): boolean {
  return parseAddress(address)?.range() === 'unicast'
}

function parseAddress(input: string): IpAddress | undefined {
  const text = stripIpv6Brackets(input)
  if (!ipaddr.isValid(text)) return undefined
  const parsed = ipaddr.parse(text)
  if (parsed.kind() === 'ipv4') return parsed
  const v6 = parsed as ipaddr.IPv6
  if (v6.isIPv4MappedAddress()) return v6.toIPv4Address()
  // IPv4-compatible (::/96) embeds an IPv4 address, except :: and ::1, which are IPv6's own.
  const range = v6.range()
  const bytes = v6.toByteArray()
  const compatible = range !== 'unspecified' && range !== 'loopback' && bytes.slice(0, 12).every(byte => byte === 0)
  return compatible ? new ipaddr.IPv4(bytes.slice(12)) : v6
}

function accept<T>(field: keyof AllowlistRules, rule: string, result: ParseResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`web-fetch-enhanced: ${field} entry ${JSON.stringify(rule)} ${describe(result.problem)}`)
}

function describe(problem: RuleProblem): string {
  switch (problem.code) {
    case 'syntax': return 'is not valid'
    case 'ipv4-form': return 'must write IPv4 as four decimal octets'
    case 'zone': return 'must not carry an IPv6 zone id'
    case 'mapped': return `is IPv4-mapped; write the IPv4 CIDR${problem.fix === undefined ? '' : ` ${problem.fix}`}`
    case 'host-bits': return `must name its network address ${problem.fix}`
    case 'wildcard': return 'may use * only as the whole left-most label'
    case 'wildcard-ip': return 'cannot wildcard an IP address'
    case 'not-hostname': return `must be a bare hostname such as ${problem.fix}`
  }
}
