import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalProvider, type LocalFetchSettings } from '../src/providers/local/index.ts'

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(`ua=${request.headers['user-agent'] ?? ''}`)
})
let origin = ''

beforeAll(async () => {
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server address')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

const settings = (overrides: Partial<LocalFetchSettings> = {}): LocalFetchSettings => ({
  allowCidrs: [],
  allowHostnames: [],
  userAgent: 'wfe-test/1.0',
  maxResponseBytes: 1_000_000,
  maxBodyChars: 10_000,
  timeoutMs: 5_000,
  maxRedirects: 3,
  ...overrides,
})

describe('local provider over the official transport', () => {
  it('keeps loopback blocked until the operator allows it', async () => {
    const provider = createLocalProvider(() => settings())
    await expect(provider.fetch({ url: `${origin}/` })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('fetches an allowed private destination with the configured User-Agent and limits', async () => {
    const provider = createLocalProvider(() => settings({ allowCidrs: ['127.0.0.1/32'], maxBodyChars: 6 }))
    await expect(provider.fetch({ url: `${origin}/` })).resolves.toMatchObject({
      statusCode: 200,
      body: { kind: 'text', content: 'ua=wfe' },
      truncated: true,
    })
  })

  it('applies the hostname second factor', async () => {
    const provider = createLocalProvider(() => settings({ allowCidrs: ['127.0.0.0/8', '::1/128'], allowHostnames: ['localhost'] }))
    await expect(provider.fetch({ url: `${origin}/` })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await expect(provider.fetch({ url: origin.replace('127.0.0.1', 'localhost') })).resolves.toMatchObject({ statusCode: 200 })
  })

  it('reads settings once per request, so edits apply to the next fetch', async () => {
    const read = vi.fn(() => settings())
    const provider = createLocalProvider(read)
    await expect(provider.fetch({ url: `${origin}/` })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    read.mockReturnValue(settings({ allowCidrs: ['127.0.0.1/32'], userAgent: '' }))
    await expect(provider.fetch({ url: `${origin}/` })).resolves.toMatchObject({ body: { content: 'ua=' } })
    expect(read).toHaveBeenCalledTimes(2)
  })
})
