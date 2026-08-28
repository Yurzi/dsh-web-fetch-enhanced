import { describe, expect, it } from 'vitest'
import { AddressPolicy, isPublicIpAddress, stripIpv6Brackets } from '../src/address-policy.ts'

describe('AddressPolicy', () => {
  it('keeps the native public-unicast baseline', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true)
    expect(isPublicIpAddress('2001:4860:4860::8888')).toBe(true)
    expect(isPublicIpAddress('127.0.0.1')).toBe(false)
    expect(isPublicIpAddress('10.0.0.1')).toBe(false)
    expect(isPublicIpAddress('169.254.169.254')).toBe(false)
    expect(isPublicIpAddress('198.18.0.1')).toBe(false)
    expect(isPublicIpAddress('::1')).toBe(false)
    expect(isPublicIpAddress('::7f00:1')).toBe(false)
    expect(isPublicIpAddress('::808:808')).toBe(true)
    expect(isPublicIpAddress('fc00::1')).toBe(false)
    expect(isPublicIpAddress('not-an-ip')).toBe(false)
  })

  it('denies every non-public address by default', () => {
    const policy = new AddressPolicy()
    expect(policy.allows('example.test', '8.8.8.8')).toBe(true)
    expect(policy.allows('example.test', '198.18.1.2')).toBe(false)
    expect(policy.allowsNonPublic('example.test', '198.18.1.2')).toBe(false)
    expect(policy.allows('example.test', 'bad')).toBe(false)
  })

  it('allows only matching IPv4 and IPv6 CIDRs', () => {
    const policy = new AddressPolicy({ allowCidrs: ['198.18.0.0/15', 'fd12:3456::/32'] })
    expect(policy.allows('fake.test', '198.18.255.254')).toBe(true)
    expect(policy.allows('fake.test', '10.0.0.1')).toBe(false)
    expect(policy.allows('fake.test', 'fd12:3456::1')).toBe(true)
    expect(policy.allows('fake.test', 'fd12:9999::1')).toBe(false)
    expect(policy.allowsNonPublic('fake.test', '198.18.1.1')).toBe(true)
    expect(policy.allowsNonPublic('fake.test', '8.8.8.8')).toBe(false)
  })

  it('normalizes mapped and compatible IPv6 before matching', () => {
    const policy = new AddressPolicy({ allowCidrs: ['192.168.0.0/16', '127.0.0.1/32'] })
    expect(policy.allows('mapped.test', '::ffff:192.168.1.7')).toBe(true)
    expect(policy.allows('compatible.test', '::7f00:1')).toBe(true)
    expect(isPublicIpAddress('::ffff:8.8.8.8')).toBe(true)
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false)
  })

  it('optionally requires exact or wildcard hostname matches for exceptions', () => {
    const policy = new AddressPolicy({
      allowCidrs: ['198.18.0.0/15'],
      allowHostnames: ['EXACT.example.', '*.proxy.example'],
    })
    expect(policy.allows('exact.example', '198.18.0.1')).toBe(true)
    expect(policy.allows('api.proxy.example', '198.18.0.1')).toBe(true)
    expect(policy.allows('deep.api.proxy.example', '198.18.0.1')).toBe(true)
    expect(policy.allows('proxy.example', '198.18.0.1')).toBe(false)
    expect(policy.allows('other.example', '198.18.0.1')).toBe(false)
    expect(policy.allows('other.example', '8.8.8.8')).toBe(true)
  })

  it('rejects malformed allowlist entries during startup', () => {
    expect(() => new AddressPolicy({ allowCidrs: [''] })).toThrow('must not contain an empty value')
    expect(() => new AddressPolicy({ allowCidrs: ['not-cidr'] })).toThrow('invalid CIDR')
    expect(() => new AddressPolicy({ allowCidrs: ['010.0.0.0/8'] })).toThrow('four decimal octets')
    expect(() => new AddressPolicy({ allowCidrs: ['0x0a000000/8'] })).toThrow('four decimal octets')
    expect(() => new AddressPolicy({ allowCidrs: ['10.0/8'] })).toThrow('four decimal octets')
    expect(() => new AddressPolicy({ allowCidrs: ['198.18.1.1/15'] })).toThrow('network base address')
    expect(() => new AddressPolicy({ allowCidrs: ['fe80::%eth0/64'] })).toThrow()
    expect(() => new AddressPolicy({ allowCidrs: ['::ffff:192.168.0.0/120'] })).toThrow('IPv4-mapped CIDR')
    expect(() => new AddressPolicy({ allowHostnames: ['foo.*.example'] })).toThrow('left-most')
    expect(() => new AddressPolicy({ allowHostnames: ['*.127.0.0.1'] })).toThrow('invalid wildcard')
    expect(() => new AddressPolicy({ allowHostnames: ['host.example:8080'] })).toThrow('must not include a port')
    expect(() => new AddressPolicy({ allowHostnames: ['host.example:80'] })).toThrow('must not include a port')
    expect(() => new AddressPolicy({ allowHostnames: ['host\\child.example'] })).toThrow('invalid hostname')
    expect(() => new AddressPolicy({ allowHostnames: [''] })).toThrow('invalid hostname')
  })

  it('strips only complete IPv6 brackets', () => {
    expect(stripIpv6Brackets('[::1]')).toBe('::1')
    expect(stripIpv6Brackets('::1')).toBe('::1')
    expect(stripIpv6Brackets('[::1')).toBe('[::1')
  })
})
