import { createServer } from 'node:http'
import type { RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebError } from '@deepseek-ai/dsh-web'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HttpFetchLimits } from '../src/provider.ts'
import { EnhancedHttpFetchProvider } from '../src/provider.ts'
import type { FetchResolver } from '../src/resolver.ts'
import { createProvider } from '../src/index.ts'

const limits: HttpFetchLimits = {
  maxResponseBytes: 1024,
  maxBodyChars: 1024,
  timeoutMs: 1000,
  maxRedirects: 3,
  userAgent: 'enhanced-test/1.0',
}

let handler: RequestListener = (_req, res) => {
  res.writeHead(500, { 'content-type': 'text/plain' })
  res.end('handler not configured')
}
const server = createServer((req, res) => handler(req, res))
let base = ''
const pinnedResolver: FetchResolver = async () => [{ address: '127.0.0.1', family: 4 }]

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  base = `http://pinned.test:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

function provider(overrides: Partial<HttpFetchLimits> = {}): EnhancedHttpFetchProvider {
  return new EnhancedHttpFetchProvider('http-enhanced', { ...limits, ...overrides }, pinnedResolver)
}

describe('EnhancedHttpFetchProvider', () => {
  it('preserves provider identity, Host header, User-Agent, and non-2xx results', async () => {
    let host = ''
    let userAgent = ''
    handler = (req, res) => {
      host = req.headers.host ?? ''
      userAgent = req.headers['user-agent'] ?? ''
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
    const instance = provider()
    expect(instance.id).toBe('http-enhanced')
    expect(instance.available()).toBe(true)
    await expect(instance.fetch({ url: `${base}/missing` })).resolves.toMatchObject({
      statusCode: 404,
      body: { kind: 'text', content: 'not found' },
      truncated: false,
    })
    expect(host).toContain('pinned.test')
    expect(userAgent).toBe('enhanced-test/1.0')
  })

  it('follows same-origin redirects and blocks cross-origin redirects', async () => {
    handler = (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/final' })
        res.end()
        return
      }
      if (req.url === '/cross') {
        res.writeHead(302, { location: `http://other.test:${(server.address() as AddressInfo).port}/final` })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<h1>done</h1>')
    }
    await expect(provider().fetch({ url: `${base}/start` })).resolves.toMatchObject({
      body: { kind: 'html', content: '<h1>done</h1>' },
    })
    await expect(provider().fetch({ url: `${base}/cross` }))
      .rejects.toMatchObject({ code: 'WEB_REDIRECT_BLOCKED' })
  })

  it('re-resolves every redirect hop and blocks a rebinding answer before connection', async () => {
    let finalHits = 0
    handler = (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/final' })
        res.end()
        return
      }
      finalHits++
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('final')
    }

    const resolver = vi.fn<FetchResolver>(async () => [{ address: '127.0.0.1', family: 4 }])
    const instance = new EnhancedHttpFetchProvider('http-enhanced', limits, resolver)
    await expect(instance.fetch({ url: `${base}/start` })).resolves.toMatchObject({ statusCode: 200 })
    expect(resolver).toHaveBeenCalledTimes(2)
    expect(finalHits).toBe(1)

    finalHits = 0
    let resolutions = 0
    const rebinding: FetchResolver = async () => {
      resolutions++
      if (resolutions === 1) return [{ address: '127.0.0.1', family: 4 }]
      throw new WebError('redirect DNS answer became blocked', 'WEB_BLOCKED_URL')
    }
    const blocked = new EnhancedHttpFetchProvider('http-enhanced', limits, rebinding)
    await expect(blocked.fetch({ url: `${base}/start` }))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(finalHits).toBe(0)
  })

  it('enforces character and streaming byte caps', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' })
      res.write('abcdef')
      res.end('ghij')
    }
    await expect(provider({ maxBodyChars: 4 }).fetch({ url: base })).resolves.toMatchObject({
      body: { content: 'abcd' },
      truncated: true,
    })
    await expect(provider({ maxResponseBytes: 5 }).fetch({ url: base })).resolves.toMatchObject({
      body: { content: 'abcde' },
      truncated: true,
    })
  })

  it('rejects declared oversized and unsupported bodies', async () => {
    handler = (req, res) => {
      if (req.url === '/binary') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end('binary')
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' })
      res.end('short')
    }
    await expect(provider({ maxResponseBytes: 10 }).fetch({ url: `${base}/large` }))
      .rejects.toMatchObject({ code: 'WEB_FETCH_TOO_LARGE' })
    await expect(provider().fetch({ url: `${base}/binary` }))
      .rejects.toMatchObject({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' })
  })

  it('classifies caller aborts and provider timeouts', async () => {
    const controller = new AbortController()
    controller.abort('cancelled')
    await expect(provider().fetch({ url: base }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })

    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('partial')
    }
    await expect(provider({ timeoutMs: 20 }).fetch({ url: base }))
      .rejects.toMatchObject({ code: 'WEB_FETCH_TIMEOUT' })
  })

  it('lets the configured allowlist reach an explicitly permitted literal', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    }
    const port = (server.address() as AddressInfo).port
    const instance = createProvider({ allowCidrs: ['127.0.0.1/32'] })
    await expect(instance.fetch({ url: `http://127.0.0.1:${port}/literal` })).resolves.toMatchObject({
      body: { kind: 'text', content: '{"ok":true}' },
    })
  })

  it('rejects redirect budget exhaustion and missing Location', async () => {
    handler = (req, res) => {
      if (req.url === '/missing-location') {
        res.writeHead(302)
        res.end()
        return
      }
      if (req.url === '/invalid-location') {
        res.writeHead(302, { location: 'http://[' })
        res.write('partial redirect body')
        return
      }
      res.writeHead(302, { location: '/again' })
      res.end()
    }
    await expect(provider({ maxRedirects: 0 }).fetch({ url: `${base}/redirect` }))
      .rejects.toMatchObject({ code: 'WEB_REDIRECT_BLOCKED' })
    await expect(provider().fetch({ url: `${base}/missing-location` }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(provider({ timeoutMs: 500 }).fetch({ url: `${base}/invalid-location` }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('invalid redirect') })
  })

  it('rejects unsupported charsets and classifies connection failures', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=not-a-real-charset' })
      res.end('text')
    }
    await expect(provider().fetch({ url: base }))
      .rejects.toMatchObject({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' })

    const unreachable = new EnhancedHttpFetchProvider(
      'http-enhanced',
      { ...limits, timeoutMs: 200 },
      async () => [{ address: '127.0.0.1', family: 4 }],
    )
    await expect(unreachable.fetch({ url: 'http://unreachable.test:1/' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})
