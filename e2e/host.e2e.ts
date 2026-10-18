/**
 * The plugin inside a real DSH 0.2.1 composition: installed by the plugin
 * manager into a fresh `web` profile, composed with the shipped base bundle,
 * and booted through the CLI's own steps. Unit tests cover the plugin's parts;
 * these tests cover what only the real composition can show — that the bundle
 * patch lands where it should and that `ctx.web` routes to the plugin.
 */
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { composedRows, enterIsolatedEnvironment } from './support/environment.ts'
import { type Host, bootHost } from './support/host.ts'

const e2e = inject('e2e')
const allowLoopback = join(import.meta.dirname, 'fixtures/allow-loopback.yml')

/** A local page that echoes the User-Agent it received. */
const page = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end(`user-agent=${request.headers['user-agent'] ?? ''}`)
})
let url = ''

beforeAll(async () => {
  enterIsolatedEnvironment(e2e.env)
  await new Promise<void>((resolve) => { page.listen(0, '127.0.0.1', resolve) })
  const address = page.address()
  if (address === null || typeof address === 'string') throw new Error('no page address')
  url = `http://127.0.0.1:${address.port}/page`
})

afterAll(async () => {
  page.closeAllConnections()
  await new Promise(resolve => page.close(resolve))
})

describe('composition', () => {
  const row = (id: string) => composedRows(e2e).find(entry => entry.id === id)

  it('swaps the native fetch row for the plugin and leaves the shared web row whole', () => {
    // A patch replaces a row's whole config. 0.0.12 rewrote `web` with only
    // fetchProvider, dropping searchProvider; on 0.2.1 that made web_search
    // ambiguous. The bundle must not touch `web` at all.
    expect(row('web')?.config).toEqual({ searchProvider: 'deepseek-official', fetchProvider: 'http' })
    expect(row('web-fetch-http')).toMatchObject({ disabled: true })
    expect(row('web-fetch-enhanced')).toMatchObject({ name: 'dsh-web-fetch-enhanced' })
    expect(row('web-fetch-enhanced')?.disabled).toBeUndefined()
  })
})

describe('runtime', () => {
  let host: Host | undefined
  afterAll(async () => { await host?.dispose() })

  it('refuses a loopback page while nothing is allowed', async () => {
    host = await bootHost(e2e, [])
    await expect(host.web.fetch({ url }, AbortSignal.timeout(15_000))).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('keeps web_search unambiguous beside the plugin', async () => {
    // Without a DeepSeek key the search provider reports a missing credential;
    // WEB_PROVIDER_AMBIGUOUS here would mean the web row lost searchProvider.
    const outcome = await host!.web.search({ query: 'deepseek harness' }, AbortSignal.timeout(15_000)).then(
      () => 'ok',
      (error: { code?: string }) => error.code,
    )
    expect(['ok', 'WEB_PROVIDER_CREDENTIAL_MISSING']).toContain(outcome)
    await host!.dispose()
    host = undefined
  })

  it('fetches the page once the operator allows loopback, with the configured User-Agent', async () => {
    host = await bootHost(e2e, [allowLoopback])
    await expect(host.web.fetch({ url }, AbortSignal.timeout(15_000))).resolves.toMatchObject({
      statusCode: 200,
      body: { kind: 'text', content: 'user-agent=wfe-e2e/1.0' },
    })
  })

  it('tells the model which ranges are open', async () => {
    const note = (await host!.modelContext()).find(entry => entry.name === 'web-fetch-enhanced:allowlist')
    expect(note?.text).toContain('[127.0.0.1/32]')
  })
})