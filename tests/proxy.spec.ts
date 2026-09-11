import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import type { Dispatcher } from 'undici'
import { Agent } from 'undici'
import { isNonPublicIpLiteral } from '../src/address-policy.ts'
import type { HttpFetchLimits } from '../src/provider.ts'
import { EnhancedHttpFetchProvider } from '../src/provider.ts'
import type { FetchResolver, ProxyRouteResolver } from '../src/resolver.ts'
import { defaultProxyRoute } from '../src/resolver.ts'

const limits: HttpFetchLimits = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 5_000,
  maxRedirects: 5,
  userAgent: 'enhanced-proxy-test/1.0',
}

let proxiedRequests: string[]
let fakeProxyServer: Server
let fakeOriginServer: Server
let fakeProxyPort: number
let fakeOriginPort: number
let proxyDispatcher: Dispatcher

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve(server.address() as AddressInfo) })
  })
}

function respond(_req: IncomingMessage, res: ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end(body)
}

beforeEach(async () => {
  proxiedRequests = []
  fakeProxyServer = createServer((req, res) => {
    proxiedRequests.push(req.url ?? '')
    respond(req, res, 'via-proxy')
  })
  fakeOriginServer = createServer((req, res) => {
    respond(req, res, 'via-origin')
  })
  const [proxyAddr, originAddr] = await Promise.all([
    listen(fakeProxyServer),
    listen(fakeOriginServer),
  ])
  fakeProxyPort = proxyAddr.port
  fakeOriginPort = originAddr.port

  // Proxy agent pointing to our fake proxy server
  proxyDispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, cb) => {
        if (options.all === true) {
          cb(null, [{ address: '127.0.0.1', family: 4 }])
          return
        }
        cb(null, '127.0.0.1', 4)
      },
    },
  })
})

afterEach(async () => {
  await proxyDispatcher.close()
  fakeProxyServer.closeAllConnections()
  fakeOriginServer.closeAllConnections()
  await Promise.all([
    new Promise<void>(r => fakeProxyServer.close(() => { r() })),
    new Promise<void>(r => fakeOriginServer.close(() => { r() })),
  ])
})

describe('isNonPublicIpLiteral', () => {
  it('identifies private and loopback IP literals correctly', () => {
    expect(isNonPublicIpLiteral('127.0.0.1')).toBe(true)
    expect(isNonPublicIpLiteral('10.0.0.5')).toBe(true)
    expect(isNonPublicIpLiteral('192.168.1.1')).toBe(true)
    expect(isNonPublicIpLiteral('169.254.169.254')).toBe(true)
    expect(isNonPublicIpLiteral('[::1]')).toBe(true)
    expect(isNonPublicIpLiteral('[::ffff:127.0.0.1]')).toBe(true)
    expect(isNonPublicIpLiteral('[::ffff:7f00:1]')).toBe(true)
    expect(isNonPublicIpLiteral('[fe80::1]')).toBe(true)
  })

  it('identifies public IP literals and hostnames correctly', () => {
    expect(isNonPublicIpLiteral('8.8.8.8')).toBe(false)
    expect(isNonPublicIpLiteral('1.1.1.1')).toBe(false)
    expect(isNonPublicIpLiteral('[2001:4860:4860::8888]')).toBe(false)
    expect(isNonPublicIpLiteral('example.com')).toBe(false)
    expect(isNonPublicIpLiteral('origin.test')).toBe(false)
  })
})

describe('fetching through proxy in EnhancedHttpFetchProvider', () => {
  it('routes public hostname through proxy dispatcher without invoking local address resolver', async () => {
    const mockResolver = vi.fn<FetchResolver>(async () => [{ address: '127.0.0.1', family: 4 }])
    const proxyResolver: ProxyRouteResolver = () => ({
      proxied: true,
      dispatcher: proxyDispatcher,
    })

    const fetcher = new EnhancedHttpFetchProvider(
      'http-enhanced',
      limits,
      mockResolver,
      proxyResolver,
    )

    const result = await fetcher.fetch({ url: `http://example.com:${fakeProxyPort}/hello` })
    expect(result.body.content).toBe('via-proxy')
    // When proxied, local DNS address resolution is bypassed
    expect(mockResolver).not.toHaveBeenCalled()
  })

  it('keeps resolving and pinning when proxy policy resolves to direct', async () => {
    const mockResolver = vi.fn<FetchResolver>(async () => [{ address: '127.0.0.1', family: 4 }])
    const proxyResolver: ProxyRouteResolver = () => ({
      proxied: false,
    })

    const fetcher = new EnhancedHttpFetchProvider(
      'http-enhanced',
      limits,
      mockResolver,
      proxyResolver,
    )

    const result = await fetcher.fetch({ url: `http://origin.test:${fakeOriginPort}/page` })
    expect(result.body.content).toBe('via-origin')
    expect(mockResolver).toHaveBeenCalledOnce()
  })

  it('refuses non-public IP literals from bypassing address check via proxy (SSRF defense)', async () => {
    const mockResolver = vi.fn<FetchResolver>(async () => {
      // Address policy rejects 10.0.0.5 as unallowlisted private IP
      throw new WebError('URL hostname "10.0.0.5" resolves to non-public IP address', 'WEB_BLOCKED_URL')
    })
    const proxyResolver: ProxyRouteResolver = () => ({
      proxied: true,
      dispatcher: proxyDispatcher,
    })

    const fetcher = new EnhancedHttpFetchProvider(
      'http-enhanced',
      limits,
      mockResolver,
      proxyResolver,
    )

    // Even though proxyResolver says proxied: true, isNonPublicIpLiteral('10.0.0.5') === true
    // forces it to go through mockResolver rather than sending to the proxy directly
    await expect(fetcher.fetch({ url: 'http://10.0.0.5:8080/sensitive' }))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })

    expect(mockResolver).toHaveBeenCalledOnce()
    expect(proxiedRequests).toHaveLength(0)
  })

  it('still enforces cross-origin redirect refusal even when proxied', async () => {
    fakeProxyServer.removeAllListeners('request')
    fakeProxyServer.on('request', (req, res) => {
      proxiedRequests.push(req.url ?? '')
      res.writeHead(302, { location: 'http://cross-origin.example/next' })
      res.end()
    })

    const proxyResolver: ProxyRouteResolver = () => ({
      proxied: true,
      dispatcher: proxyDispatcher,
    })

    const fetcher = new EnhancedHttpFetchProvider(
      'http-enhanced',
      limits,
      async () => [{ address: '127.0.0.1', family: 4 }],
      proxyResolver,
    )

    await expect(fetcher.fetch({ url: `http://127.0.0.1:${fakeProxyPort}/redirect` }))
      .rejects.toMatchObject({ code: 'WEB_REDIRECT_BLOCKED' })
  })
})

describe('defaultProxyRoute', () => {
  it('returns unproxied route for loopback addresses', () => {
    const route = defaultProxyRoute(new URL('http://127.0.0.1:8080/status'))
    expect(route).toEqual({ proxied: false })
  })
})
