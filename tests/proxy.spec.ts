import { createServer } from 'node:http'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalProvider } from '../src/providers/local/index.ts'

const seen: string[] = []
const proxy = createServer((request, response) => {
  seen.push(request.url ?? '')
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('via proxy')
})
let uninstall: () => Promise<void>

beforeAll(async () => {
  await new Promise<void>((resolve) => { proxy.listen(0, '127.0.0.1', resolve) })
  const address = proxy.address()
  if (address === null || typeof address === 'string') throw new Error('no proxy address')
  // The launcher installs this policy for the whole process before plugins load.
  const value = `http://127.0.0.1:${address.port}`
  uninstall = await installProxyFromEnvironment({ get: name => name === 'HTTP_PROXY' ? { value } : undefined }, () => {})
})

afterAll(async () => {
  await uninstall()
  proxy.closeAllConnections()
  await new Promise(resolve => proxy.close(resolve))
})

const provider = createLocalProvider(() => ({
  allowCidrs: [],
  allowHostnames: [],
  userAgent: 'wfe-test/1.0',
  maxResponseBytes: 100_000,
  maxBodyChars: 10_000,
  timeoutMs: 5_000,
  maxRedirects: 0,
}))

describe('local provider behind an outbound proxy', () => {
  it('sends public destinations through the proxy', async () => {
    await expect(provider.fetch({ url: 'http://93.184.216.34/page' })).resolves.toMatchObject({ body: { content: 'via proxy' } })
    expect(seen).toEqual(['http://93.184.216.34/page'])
  })

  it.each(['http://[::7f00:1]:8080/', 'http://[::a00:1]/', 'http://10.0.0.1/'])('never hands a disallowed IP literal to the proxy: %s', async (url) => {
    seen.length = 0
    await expect(provider.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(seen).toEqual([])
  })
})
