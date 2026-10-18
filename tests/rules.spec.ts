import { describe, expect, it } from 'vitest'
import { AddressPolicy, isPublicAddress } from '../src/providers/local/index.ts'
import { cidrWarnings, parseCidr, parseHostnameRule } from '../src/providers/local/rules.ts'

describe('CIDR rules', () => {
  it.each(['198.18.0.0/15', '10.20.0.0/16', 'fd12:3456::/32', '127.0.0.1/32'])('accepts %s', (rule) => {
    expect(parseCidr(rule).ok).toBe(true)
  })

  it.each([
    ['not-a-cidr', { code: 'syntax' }],
    ['10.0.0.0', { code: 'syntax' }],
    ['10.0.0.0/33', { code: 'syntax' }],
    ['010.0.0.0/8', { code: 'ipv4-form' }],
    ['10.1/16', { code: 'ipv4-form' }],
    ['fe80::%eth0/64', { code: 'zone' }],
    ['198.18.1.1/15', { code: 'host-bits', fix: '198.18.0.0/15' }],
    ['::ffff:192.168.0.0/120', { code: 'mapped', fix: '192.168.0.0/24' }],
  ])('refuses %s', (rule, problem) => {
    expect(parseCidr(rule)).toEqual({ ok: false, problem })
  })

  it('warns about ranges that widen reachability unexpectedly', () => {
    const warnings = (rule: string) => {
      const parsed = parseCidr(rule)
      if (!parsed.ok) throw new Error(rule)
      return cidrWarnings(parsed.value)
    }
    expect(warnings('198.18.0.0/15')).toEqual([])
    expect(warnings('169.254.0.0/16')).toEqual(['metadata'])
    expect(warnings('127.0.0.0/8')).toEqual(['loopback'])
    expect(warnings('0.0.0.0/0')).toEqual(['metadata', 'loopback', 'broad'])
    expect(warnings('8.8.8.0/24')).toEqual(['public'])
  })
})

describe('hostname rules', () => {
  it('normalizes exact and wildcard rules', () => {
    expect(parseHostnameRule(' Wiki.Example.com. ')).toEqual({ ok: true, value: { kind: 'exact', hostname: 'wiki.example.com' } })
    expect(parseHostnameRule('*.example.com')).toEqual({ ok: true, value: { kind: 'suffix', suffix: '.example.com' } })
    expect(parseHostnameRule('[::1]')).toEqual({ ok: true, value: { kind: 'exact', hostname: '::1' } })
  })

  it.each([
    ['', { code: 'syntax' }],
    ['foo.*.example.com', { code: 'wildcard' }],
    ['*.127.0.0.1', { code: 'wildcard-ip' }],
    ['https://wiki.example.com/page', { code: 'not-hostname', fix: 'wiki.example.com' }],
    ['wiki.example.com:8080', { code: 'not-hostname', fix: 'wiki.example.com' }],
    ['user@example.com', { code: 'syntax' }],
  ])('refuses %j', (rule, problem) => {
    expect(parseHostnameRule(rule)).toEqual({ ok: false, problem })
  })
})

describe('AddressPolicy', () => {
  const policy = (allowCidrs: string[], allowHostnames: string[] = []) => new AddressPolicy({ allowCidrs, allowHostnames })

  it('keeps the public-only baseline when nothing is allowed', () => {
    const empty = policy([])
    expect(empty.allows('example.com', '93.184.216.34')).toBe(true)
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '198.18.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1', '::7f00:1']) {
      expect(empty.allows('example.com', address), address).toBe(false)
    }
  })

  it('allows a non-public address only inside a configured CIDR', () => {
    const fakeIp = policy(['198.18.0.0/15', 'fd12:3456::/32'])
    expect(fakeIp.allows('any.test', '198.19.255.254')).toBe(true)
    expect(fakeIp.allows('any.test', '::ffff:198.18.0.9')).toBe(true)
    expect(fakeIp.allows('any.test', 'fd12:3456::1')).toBe(true)
    expect(fakeIp.allows('any.test', '10.0.0.1')).toBe(false)
  })

  it('requires a matching hostname when hostname rules exist, without restricting public sites', () => {
    const scoped = policy(['198.18.0.0/15'], ['api.example.com', '*.docs.example.com'])
    expect(scoped.allows('api.example.com', '198.18.0.1')).toBe(true)
    expect(scoped.allows('a.docs.example.com', '198.18.0.1')).toBe(true)
    expect(scoped.allows('docs.example.com', '198.18.0.1')).toBe(false)
    expect(scoped.allows('other.example.com', '198.18.0.1')).toBe(false)
    expect(scoped.allows('other.example.com', '93.184.216.34')).toBe(true)
  })

  it('refuses invalid rules with the offending entry named', () => {
    expect(() => policy(['198.18.1.1/15'])).toThrow('allowCidrs entry "198.18.1.1/15" must name its network address 198.18.0.0/15')
    expect(() => policy([], ['https://example.com'])).toThrow('allowHostnames entry')
  })

  it('classifies public unicast like the native provider', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('[2001:4860:4860::8888]')).toBe(true)
    expect(isPublicAddress('100.64.0.1')).toBe(false)
    expect(isPublicAddress('not-an-ip')).toBe(false)
  })
})
