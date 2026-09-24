import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as plugin from '../src/index.ts'

async function boot(base: plugin.ProviderConfig = {}) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Loader)
  await ctx.plugin(WebRuntime, { fetchProvider: 'http-enhanced' })
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  ctx.loader.builtins.enhanced = plugin
  await ctx.loader.root.update([{ id: plugin.SETTINGS_NAMESPACE, name: 'cordis:enhanced', config: base }])
  await ctx.loader.await()
  const entry = ctx.loader.resolve(plugin.SETTINGS_NAMESPACE)
  await entry.fiber!.await()
  const config = entry.fiber!.config as plugin.Config
  const update = async (value: plugin.ProviderConfig) => {
    await entry.update({ config: value })
    await ctx.loader.await()
  }
  const prompt = async () => (await ctx.systemPrompt.assemble()).sections
    .find(section => section.name === 'web-fetch-enhanced:allowlist')?.text
  return { ctx, entry, config, update, prompt }
}

async function endpoint() {
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/plain'); res.end(req.headers['user-agent']) })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing server address')
  return 'http://127.0.0.1:' + address.port + '/'
}

describe('Loader live Config integration', () => {
  it('marks only mutable fields volatile and returns immutable snapshots', () => {
    expect(plugin.Config.dict!.providerId!.meta.volatile).not.toBe(true)
    for (const [name, field] of Object.entries(plugin.Config.dict!)) {
      if (name !== 'providerId') expect(field.meta.volatile).toBe(true)
    }
    const config = plugin.Config({ allowCidrs: ['127.0.0.1/32'] })
    expect(config.allowCidrs.get()).toEqual(['127.0.0.1/32'])
    expect(Object.isFrozen(config.allowCidrs.get())).toBe(true)
  })

  it('applies and revokes exceptions without remounting or registering settings', async () => {
    const { ctx, entry, config, update, prompt } = await boot()
    const fiber = entry.fiber
    const ref = config.allowCidrs
    const url = await endpoint()
    await expect(ctx.web.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await update({ allowCidrs: ['127.0.0.1/32'], userAgent: 'live-agent' })
    expect(entry.fiber).toBe(fiber)
    expect(config.allowCidrs).toBe(ref)
    expect((await ctx.web.fetch({ url })).body.content).toBe('live-agent')
    expect(await prompt()).toContain('127.0.0.1/32')
    await update({})
    expect(config.allowCidrs.get()).toEqual([])
    expect(await prompt()).toBe('')
    await expect(ctx.web.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it.each([
    { allowCidrs: ['not-a-cidr'] },
    { allowHostnames: ['bad/path'] },
    { maxResponseBytes: 0 },
    { maxBodyChars: Number.NaN },
    { timeoutMs: 2_147_483_648 },
    { maxRedirects: -1 },
    { maxRedirects: 1.5 },
    { userAgent: 'bad\r\nheader' },
  ])('rejects an invalid candidate before committing any field: %j', async (invalid) => {
    const { ctx, config, update, prompt } = await boot()
    const changed = vi.fn()
    ctx.on('system-prompt/change', changed)
    const candidate = { allowCidrs: ['127.0.0.1/32'], userAgent: 'changed', ...invalid }
    // SettingsForms uses this same schema preflight before persisting any profile patch.
    expect(() => plugin.Config(candidate)).toThrow()
    // Raw Loader edits retain invalid raw values, but never partially commit live refs.
    await update(candidate)
    expect(config.allowCidrs.get()).toEqual([])
    expect(config.userAgent.get()).toBe(plugin.DEFAULT_USER_AGENT)
    expect(await prompt()).toBe('')
    expect(changed).not.toHaveBeenCalled()
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1/' })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('reads new limits for subsequent requests and preserves an in-flight snapshot', async () => {
    const { ctx, update } = await boot({ allowCidrs: ['127.0.0.1/32'], userAgent: 'snapshot-agent' })
    let release!: () => void
    let arrived!: () => void
    const started = new Promise<void>(resolve => { arrived = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const server = createServer((_req, res) => {
      arrived()
      void gate.then(() => { res.setHeader('content-type', 'text/plain'); res.end('abcdef') })
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    onTestFinished(async () => {
      release()
      server.closeAllConnections()
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing server address')
    const url = 'http://127.0.0.1:' + address.port + '/'
    const pending = ctx.web.fetch({ url })
    await started
    await update({ allowCidrs: ['127.0.0.1/32'], maxBodyChars: 2 })
    release()
    expect((await pending).body.content).toBe('abcdef')
    expect(await ctx.web.fetch({ url })).toMatchObject({ body: { content: 'ab' }, truncated: true })
  })

  it('notifies after both allowlist fields commit, but not for limits or no-ops', async () => {
    const { ctx, config, update } = await boot()
    const changed = vi.fn(() => ({ cidrs: config.allowCidrs.get(), hosts: config.allowHostnames.get() }))
    ctx.on('system-prompt/change', changed)
    const value = { allowCidrs: ['127.0.0.1/32'], allowHostnames: ['localhost'] }
    await update(value)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.results[0]?.value).toEqual({ cidrs: value.allowCidrs, hosts: value.allowHostnames })
    await update({ ...value, maxBodyChars: 123 })
    await update({ ...value, maxBodyChars: 123 })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('remounts ordinary provider identity changes and releases registrations on disposal', async () => {
    const { ctx, entry, update, prompt } = await boot()
    const config = entry.fiber!.config
    await update({ providerId: 'replacement' })
    expect(entry.fiber!.config).not.toBe(config)
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1/' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    await entry.fiber!.dispose()
    expect(await prompt()).toBeUndefined()
  })
})
