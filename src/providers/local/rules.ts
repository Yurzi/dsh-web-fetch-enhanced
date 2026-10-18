/**
 * Grammar of the local provider's allowlist rules. The Host policy and the
 * settings page parse with this one module, so a line the page accepts is a
 * line the Host accepts, and a refused line can be explained and corrected
 * in the browser instead of failing a save.
 */
import ipaddr from 'ipaddr.js'

/** A parsed IPv4 or IPv6 address. */
export type IpAddress = ipaddr.IPv4 | ipaddr.IPv6

/** A CIDR written as its network base address. */
export interface Cidr {
  readonly network: IpAddress
  readonly prefixLength: number
}

/** An exact hostname, or a left-most wildcard matching strict subdomains of `suffix`. */
export type HostnameRule =
  | { readonly kind: 'exact'; readonly hostname: string }
  | { readonly kind: 'suffix'; readonly suffix: string }

/** Why a rule line is refused; `fix` is the corrected line when exactly one is meant. */
export type RuleProblem =
  /** Not a CIDR or hostname at all. */
  | { readonly code: 'syntax' }
  /** IPv4 written in a form other than four decimal octets, such as `010.0.0.0/8` or `10.1/16`. */
  | { readonly code: 'ipv4-form' }
  /** An IPv6 zone id such as `%eth0`, which no destination address carries. */
  | { readonly code: 'zone' }
  /** An IPv4-mapped IPv6 CIDR; addresses are matched as their IPv4 form. */
  | { readonly code: 'mapped'; readonly fix?: string }
  /** Host bits set below the prefix; the rule must name its network address. */
  | { readonly code: 'host-bits'; readonly fix: string }
  /** A `*` anywhere but a whole left-most label. */
  | { readonly code: 'wildcard' }
  /** A wildcard over an IP address. */
  | { readonly code: 'wildcard-ip' }
  /** A URL, path, or port where a bare hostname belongs. */
  | { readonly code: 'not-hostname'; readonly fix: string }

/** Accepted CIDRs that deserve a second look before they widen reachability. */
export type CidrWarning =
  /** A public range: public addresses are reachable without any rule. */
  | 'public'
  /** Shorter than /8 (IPv4) or /16 (IPv6). */
  | 'broad'
  /** Includes this machine's loopback address. */
  | 'loopback'
  /** Includes the cloud instance metadata endpoint. */
  | 'metadata'

/** Outcome of parsing one rule line. */
export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: RuleProblem }

const DECIMAL_IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const PREFIX = /^(?:0|[1-9]\d*)$/
const LOOPBACK = [ipaddr.parse('127.0.0.1'), ipaddr.parse('::1')]
const METADATA = [ipaddr.parse('169.254.169.254'), ipaddr.parse('fd00:ec2::254')]

/**
 * Parse one CIDR rule.
 * @param input - one line as typed; surrounding whitespace is ignored.
 * @returns the CIDR, or why it is refused.
 */
export function parseCidr(input: string): ParseResult<Cidr> {
  const [address = '', prefix, ...extra] = input.trim().split('/')
  if (prefix === undefined || extra.length > 0 || !PREFIX.test(prefix)) return refuse('syntax')
  if (address.includes('%')) return refuse('zone')
  const prefixLength = Number(prefix)
  let network: IpAddress
  if (address.includes(':')) {
    if (!ipaddr.IPv6.isValid(address) || prefixLength > 128) return refuse('syntax')
    network = ipaddr.IPv6.parse(address)
    if (network.isIPv4MappedAddress()) {
      const fix = prefixLength >= 96 ? `${network.toIPv4Address().toString()}/${prefixLength - 96}` : undefined
      return { ok: false, problem: fix === undefined ? { code: 'mapped' } : { code: 'mapped', fix } }
    }
  } else {
    if (!DECIMAL_IPV4.test(address)) return refuse(ipaddr.IPv4.isValid(address) ? 'ipv4-form' : 'syntax')
    if (prefixLength > 32) return refuse('syntax')
    network = ipaddr.IPv4.parse(address)
  }
  const base = network.kind() === 'ipv4'
    ? ipaddr.IPv4.networkAddressFromCIDR(`${address}/${prefixLength}`)
    : ipaddr.IPv6.networkAddressFromCIDR(`${address}/${prefixLength}`)
  if (base.toString() !== network.toString()) {
    return { ok: false, problem: { code: 'host-bits', fix: `${base.toString()}/${prefixLength}` } }
  }
  return { ok: true, value: { network, prefixLength } }
}

/**
 * Parse one hostname rule: an exact hostname, an IP literal, or `*.` plus a hostname.
 * @param input - one line as typed; surrounding whitespace is ignored.
 * @returns the normalized rule, or why it is refused.
 */
export function parseHostnameRule(input: string): ParseResult<HostnameRule> {
  const source = input.trim()
  if (source.startsWith('*.')) {
    const base = source.slice(2)
    if (base.includes('*')) return refuse('wildcard')
    const parsed = parseHostname(base)
    if (!parsed.ok) return parsed
    if (isIpLiteral(parsed.value)) return refuse('wildcard-ip')
    return { ok: true, value: { kind: 'suffix', suffix: `.${parsed.value}` } }
  }
  if (source.includes('*')) return refuse('wildcard')
  const parsed = parseHostname(source)
  return parsed.ok ? { ok: true, value: { kind: 'exact', hostname: parsed.value } } : parsed
}

/**
 * Notes about an accepted CIDR that widens reachability more than its author may intend.
 * @param cidr - an accepted rule.
 * @returns every warning that applies, most severe first.
 */
export function cidrWarnings(cidr: Cidr): CidrWarning[] {
  const covers = (targets: readonly IpAddress[]) => targets.some(target => matchesCidr(target, cidr))
  const warnings: CidrWarning[] = []
  if (covers(METADATA)) warnings.push('metadata')
  if (covers(LOOPBACK)) warnings.push('loopback')
  if (cidr.prefixLength < (cidr.network.kind() === 'ipv4' ? 8 : 16)) warnings.push('broad')
  else if (cidr.network.range() === 'unicast') warnings.push('public')
  return warnings
}

/**
 * Whether an address lies inside a CIDR of the same family.
 * @param address - the parsed address.
 * @param cidr - the rule.
 * @returns true for a match.
 */
export function matchesCidr(address: IpAddress, cidr: Cidr): boolean {
  return address.kind() === cidr.network.kind() && address.match(cidr.network, cidr.prefixLength)
}

/**
 * Normalize a URL hostname for rule comparison: no IPv6 brackets, no trailing
 * dot, lower case, and IP literals in canonical form.
 * @param hostname - `URL.hostname` or a rule's host part.
 * @returns the comparable form.
 */
export function normalizeHost(hostname: string): string {
  const host = stripIpv6Brackets(hostname).replace(/\.$/, '').toLowerCase()
  return ipaddr.IPv6.isValid(host) ? ipaddr.IPv6.parse(host).toString() : host
}

/** WHATWG URL keeps brackets around an IPv6 hostname; address parsers do not. */
export function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function parseHostname(source: string): ParseResult<string> {
  if (source === '' || /[\s@\\]/.test(source)) return refuse('syntax')
  const bare = stripIpv6Brackets(source)
  if (DECIMAL_IPV4.test(bare) || ipaddr.IPv6.isValid(bare)) return { ok: true, value: normalizeHost(bare) }
  // A URL, a path, or a port: offer the hostname it names.
  if (/[/:?#]/.test(source)) {
    const url = URL.parse(/^[a-z][a-z\d+.-]*:\/\//i.test(source) ? source : `http://${source}`)
    if (url === null || url.hostname === '') return refuse('syntax')
    return { ok: false, problem: { code: 'not-hostname', fix: normalizeHost(url.hostname) } }
  }
  const url = URL.parse(`http://${source}/`)
  return url === null || url.hostname === '' ? refuse('syntax') : { ok: true, value: normalizeHost(url.hostname) }
}

function isIpLiteral(host: string): boolean {
  return DECIMAL_IPV4.test(host) || ipaddr.IPv6.isValid(host)
}

function refuse(code: 'syntax' | 'ipv4-form' | 'zone' | 'wildcard' | 'wildcard-ip'): { ok: false; problem: RuleProblem } {
  return { ok: false, problem: { code } }
}
