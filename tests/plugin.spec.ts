import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as plugin from '../src/index.ts'
import { ENTRY_ID } from '../src/contract.ts'

/** Boot the plugin the way a Profile does: Loader rows for `web` and this plugin. */
async function boot(config: object = {}) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Loader)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  ctx.loader.builtins.web = WebRuntime
  ctx.loader.builtins.enhanced = plugin
  await ctx.loader.root.update([
    { id: 'web', name: 'cordis:web', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
    { id: ENTRY_ID, name: 'cordis:enhanced', config },
  ])
  await ctx.loader.await()
  const update = async (id: string, value: object) => {
    await ctx.loader.resolve(id).update({ config: value })
    await ctx.loader.await()
  }
  const note = async () => (await ctx.systemPrompt.assemble()).contexts
    .find(context => context.name === 'web-fetch-enhanced:allowlist')?.text ?? ''
  return { ctx, update, note, entry: () => ctx.loader.resolve(ENTRY_ID) }
}

async function loopbackUrl() {
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/plain'); response.end('ok') })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server address')
  return `http://127.0.0.1:${address.port}/`
}

describe('plugin in a Loader composition', () => {
  it('serves web_fetch from the native seat and applies allowlist edits live', async () => {
    const { ctx, update, entry } = await boot()
    const url = await loopbackUrl()
    const fiber = entry().fiber
    await expect(ctx.web.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await update(ENTRY_ID, { allowCidrs: ['127.0.0.1/32'] })
    await expect(ctx.web.fetch({ url })).resolves.toMatchObject({ body: { content: 'ok' } })
    expect(entry().fiber).toBe(fiber)
  })

  it('commits nothing from an invalid candidate', async () => {
    const { ctx, update } = await boot()
    const url = await loopbackUrl()
    await update(ENTRY_ID, { allowCidrs: ['127.0.0.1/32'], userAgent: 'bad\nvalue' })
    await expect(ctx.web.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('tells the model about open ranges only while it serves web_fetch', async () => {
    const { update, note } = await boot()
    expect(await note()).toBe('')
    await update(ENTRY_ID, { allowCidrs: ['198.18.0.0/15'], allowHostnames: ['*.example.com'] })
    expect(await note()).toContain('[198.18.0.0/15]')
    expect(await note()).toContain('[*.example.com]')
    await update('web', { searchProvider: 'deepseek-official', fetchProvider: 'deepseek-fetch-api' })
    expect(await note()).toBe('')
  })

  it('leaves nothing registered after its fiber stops', async () => {
    const { ctx, entry, note } = await boot({ allowCidrs: ['198.18.0.0/15'] })
    await entry().fiber!.dispose()
    await expect(ctx.web.fetch({ url: 'https://example.com/' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    expect(await note()).toBe('')
  })
})
