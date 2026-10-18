import type { LookupAddress } from 'node:dns'
import { describe, expect, it, vi } from 'vitest'
import { AddressPolicy } from '../src/providers/local/index.ts'
import { type AddressLookup, resolveAllowedAddresses } from '../src/providers/local/resolver.ts'

const signal = () => new AbortController().signal
const policy = (allowCidrs: string[] = [], allowHostnames: string[] = []) => new AddressPolicy({ allowCidrs, allowHostnames })
const answers = (...entries: LookupAddress[]): AddressLookup => vi.fn(async () => entries)

describe('resolveAllowedAddresses', () => {
  it('returns the whole validated answer set', async () => {
    await expect(resolveAllowedAddresses('fake.test', signal(), policy(['198.18.0.0/15']),
      answers({ address: '93.184.216.34', family: 4 }, { address: '198.18.20.30', family: 4 })))
      .resolves.toEqual([{ address: '93.184.216.34', family: 4 }, { address: '198.18.20.30', family: 4 }])
  })

  it('refuses the whole set when any answer is outside the allowlist', async () => {
    await expect(resolveAllowedAddresses('mixed.test', signal(), policy(),
      answers({ address: '93.184.216.34', family: 4 }, { address: '10.0.0.2', family: 4 })))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('checks an IPv4 literal without DNS', async () => {
    const lookup = vi.fn<AddressLookup>()
    await expect(resolveAllowedAddresses('127.0.0.1', signal(), policy(['127.0.0.1/32']), lookup))
      .resolves.toEqual([{ address: '127.0.0.1', family: 4 }])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects empty and malformed answers as provider errors', async () => {
    await expect(resolveAllowedAddresses('empty.test', signal(), policy(), answers()))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(resolveAllowedAddresses('family.test', signal(), policy(), answers({ address: '8.8.8.8', family: 6 })))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('checks the IPv4 address an active NAT64 prefix translates to', async () => {
    const lookup: AddressLookup = async hostname => hostname === 'ipv4only.arpa'
      ? [{ address: '2001:4860:64::c000:aa', family: 6 }]
      : [{ address: '2001:4860:64::c0a8:101', family: 6 }]
    await expect(resolveAllowedAddresses('nat64.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: expect.stringContaining('192.168.1.1') })
    await expect(resolveAllowedAddresses('nat64.test', signal(), policy(['192.168.0.0/16']), lookup))
      .resolves.toHaveLength(1)
  })

  it('checks every overlapping NAT64 prefix, not the first match', async () => {
    const lookup: AddressLookup = async hostname => hostname === 'ipv4only.arpa'
      ? [
          // As /32 the target embeds public 8.8.8.8; as /96 it embeds loopback.
          { address: '2001:4860:c000:aa::', family: 6 },
          { address: '2001:4860:808:808::c000:aa', family: 6 },
        ]
      : [{ address: '2001:4860:808:808::7f00:1', family: 6 }]
    await expect(resolveAllowedAddresses('overlap.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: expect.stringContaining('127.0.0.1') })
  })

  it('stops waiting for DNS once the request is cancelled', async () => {
    const controller = new AbortController()
    const pending = resolveAllowedAddresses('slow.test', controller.signal, policy(), () => new Promise(() => {}))
    controller.abort('cancelled')
    await expect(pending).rejects.toThrow('aborted during hostname resolution')
  })
})
