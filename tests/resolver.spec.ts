import type { LookupAddress, LookupOptions } from 'node:dns'
import { describe, expect, it, vi } from 'vitest'
import { AddressPolicy } from '../src/address-policy.ts'
import type { AddressResolver } from '../src/resolver.ts'
import { createPinnedLookup, resolveAllowedAddresses } from '../src/resolver.ts'

const signal = (): AbortSignal => new AbortController().signal
const answers = (...entries: LookupAddress[]): AddressResolver => vi.fn(async () => entries)

describe('resolveAllowedAddresses', () => {
  it('allows public answers and explicit fake-IP CIDRs', async () => {
    await expect(resolveAllowedAddresses(
      'public.test', signal(), new AddressPolicy(), answers({ address: '8.8.8.8', family: 4 }),
    )).resolves.toEqual([{ address: '8.8.8.8', family: 4 }])

    await expect(resolveAllowedAddresses(
      'fake.test',
      signal(),
      new AddressPolicy({ allowCidrs: ['198.18.0.0/15'] }),
      answers({ address: '198.18.20.30', family: 4 }),
    )).resolves.toEqual([{ address: '198.18.20.30', family: 4 }])
  })

  it('blocks non-public answers without a matching exception', async () => {
    await expect(resolveAllowedAddresses(
      'fake.test', signal(), new AddressPolicy(), answers({ address: '198.18.0.1', family: 4 }),
    )).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('rejects the whole DNS set when any answer is blocked', async () => {
    await expect(resolveAllowedAddresses(
      'mixed.test',
      signal(),
      new AddressPolicy(),
      answers({ address: '8.8.8.8', family: 4 }, { address: '10.0.0.2', family: 4 }),
    )).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('requires hostname rules as a second factor when configured', async () => {
    const policy = new AddressPolicy({
      allowCidrs: ['198.18.0.0/15'],
      allowHostnames: ['allowed.test'],
    })
    await expect(resolveAllowedAddresses(
      'blocked.test', signal(), policy, answers({ address: '198.18.0.1', family: 4 }),
    )).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await expect(resolveAllowedAddresses(
      'allowed.test', signal(), policy, answers({ address: '198.18.0.1', family: 4 }),
    )).resolves.toHaveLength(1)
  })

  it('handles literals without invoking DNS', async () => {
    const resolver = vi.fn<AddressResolver>()
    await expect(resolveAllowedAddresses(
      '127.0.0.1', signal(), new AddressPolicy({ allowCidrs: ['127.0.0.1/32'] }), resolver,
    )).resolves.toEqual([{ address: '127.0.0.1', family: 4 }])
    expect(resolver).not.toHaveBeenCalled()
  })

  it('rejects empty and malformed DNS answer sets', async () => {
    await expect(resolveAllowedAddresses(
      'empty.test', signal(), new AddressPolicy(), answers(),
    )).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(resolveAllowedAddresses(
      'family.test', signal(), new AddressPolicy(), answers({ address: '8.8.8.8', family: 6 }),
    )).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('checks an active custom NAT64 prefix against the embedded IPv4', async () => {
    const resolver: AddressResolver = vi.fn(async (hostname) => hostname === 'ipv4only.arpa'
      ? [
          { address: '2001:4860:64::c000:aa', family: 6 },
          { address: '2001:4860:64::c000:ab', family: 6 },
        ]
      : [{ address: '2001:4860:64::c0a8:101', family: 6 }])

    await expect(resolveAllowedAddresses(
      'nat64.test', signal(), new AddressPolicy(), resolver,
    )).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: expect.stringContaining('NAT64') })

    await expect(resolveAllowedAddresses(
      'nat64.test', signal(), new AddressPolicy({ allowCidrs: ['192.168.0.0/16'] }), resolver,
    )).resolves.toEqual([{ address: '2001:4860:64::c0a8:101', family: 6 }])
  })

  it('validates every overlapping discovered NAT64 prefix', async () => {
    const resolver: AddressResolver = vi.fn(async (hostname) => hostname === 'ipv4only.arpa'
      ? [
          // /32 candidate. The target embeds public 8.8.8.8 in this layout.
          { address: '2001:4860:c000:aa::', family: 6 },
          // Overlapping /96 candidate. The target embeds loopback 127.0.0.1 here.
          { address: '2001:4860:808:808::c000:aa', family: 6 },
        ]
      : [{ address: '2001:4860:808:808::7f00:1', family: 6 }])

    await expect(resolveAllowedAddresses(
      'overlap-nat64.test', signal(), new AddressPolicy(), resolver,
    )).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: expect.stringContaining('127.0.0.1') })
  })

  it('stops waiting for DNS when aborted', async () => {
    const controller = new AbortController()
    const pending: AddressResolver = vi.fn(async () => await new Promise<LookupAddress[]>(() => {}))
    const result = resolveAllowedAddresses('slow.test', controller.signal, new AddressPolicy(), pending)
    controller.abort('test')
    await expect(result).rejects.toThrow('aborted during hostname resolution')
  })
})

describe('createPinnedLookup', () => {
  it('returns only validated addresses and respects requested family', () => {
    const lookup = createPinnedLookup([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ])
    const callback = vi.fn()
    lookup('example.test', { all: true, family: 6 } as LookupOptions, callback)
    expect(callback).toHaveBeenCalledWith(null, [{ address: '2001:4860:4860::8888', family: 6 }])
  })

  it('reports ENOTFOUND when the requested family has no validated address', () => {
    const lookup = createPinnedLookup([{ address: '8.8.8.8', family: 4 }])
    const callback = vi.fn()
    lookup('example.test', { all: false, family: 6 } as LookupOptions, callback)
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ code: 'ENOTFOUND', hostname: 'example.test' })
  })

  it('supports the single-address callback shape', () => {
    const lookup = createPinnedLookup([{ address: '8.8.8.8', family: 4 }])
    const callback = vi.fn()
    lookup('example.test', { all: false } as LookupOptions, callback)
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4)
  })
})
