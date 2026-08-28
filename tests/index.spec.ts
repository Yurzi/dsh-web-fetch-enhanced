import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

describe('Cordis plugin entry', () => {
  it('uses namespace exports without a default export', () => {
    expect(plugin.name).toBe('web-fetch-enhanced')
    expect(plugin.inject).toEqual(['web'])
    expect(plugin.DEFAULT_PROVIDER_ID).toBe('http-enhanced')
    expect('default' in plugin).toBe(false)
  })

  it('builds providers with defaults and a configurable id', () => {
    expect(plugin.createProvider().id).toBe('http-enhanced')
    expect(plugin.createProvider({ providerId: 'http' }).id).toBe('http')
  })

  it('fails loud on invalid startup configuration', () => {
    expect(() => plugin.createProvider({ providerId: 'bad id' })).toThrow('providerId')
    expect(() => plugin.createProvider({ maxResponseBytes: 0 })).toThrow('maxResponseBytes')
    expect(() => plugin.createProvider({ maxBodyChars: Number.NaN })).toThrow('maxBodyChars')
    expect(() => plugin.createProvider({ timeoutMs: 2_147_483_648 })).toThrow('timeoutMs')
    expect(() => plugin.createProvider({ maxRedirects: -1 })).toThrow('maxRedirects')
    expect(() => plugin.createProvider({ maxRedirects: 1.5 })).toThrow('maxRedirects')
  })

  it('registers exactly one fetch provider on ctx.web', () => {
    const registerFetchProvider = vi.fn()
    const ctx = { web: { registerFetchProvider }, inject: vi.fn() } as unknown as Context
    plugin.apply(ctx, { providerId: 'chosen' })
    expect(registerFetchProvider).toHaveBeenCalledTimes(1)
    expect(registerFetchProvider.mock.calls[0]?.[0]).toMatchObject({ id: 'chosen' })
  })

  it('mounts, rejects duplicate ids, and unregisters with its real Cordis fiber', async () => {
    const ctx = new Context()
    const webFiber = await ctx.plugin(WebRuntime, { fetchProvider: 'http-enhanced' })
    const contribution = () => Object.assign(
      (inner: Context) => { plugin.apply(inner, {}) },
      { inject: ['web'] },
    )
    const fiber = await ctx.plugin(contribution())

    await expect(ctx.web.fetch({ url: 'http://127.0.0.1/' }))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await expect(ctx.plugin(contribution()))
      .rejects.toMatchObject({ code: 'WEB_DUPLICATE_PROVIDER' })

    await fiber.dispose()
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1/' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    await webFiber.dispose()
  })
})
