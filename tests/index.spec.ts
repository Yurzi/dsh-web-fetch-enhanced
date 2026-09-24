import { Context, Service } from '@deepseek-ai/cordis'
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

  it('rejects unsafe startup values at the actual Config boundary', () => {
    for (const value of [
      { providerId: 'bad id' }, { allowCidrs: ['bad'] }, { allowHostnames: ['*'] },
      { maxResponseBytes: Infinity }, { maxBodyChars: 0 }, { timeoutMs: 0 },
      { maxRedirects: NaN }, { userAgent: 'injected\nheader' },
    ]) expect(() => plugin.Config(value)).toThrow()
  })

  it('registers exactly one fetch provider on ctx.web', () => {
    const registerFetchProvider = vi.fn()
    const ctx = { web: { registerFetchProvider }, inject: vi.fn(), on: vi.fn() } as unknown as Context
    plugin.apply(ctx, plugin.Config({ providerId: 'chosen' }))
    expect(registerFetchProvider).toHaveBeenCalledTimes(1)
    expect(registerFetchProvider.mock.calls[0]?.[0]).toMatchObject({ id: 'chosen' })
  })

  it('mounts, rejects duplicate ids, and unregisters with its real Cordis fiber', async () => {
    const ctx = new Context()
    const webFiber = await ctx.plugin(WebRuntime, { fetchProvider: 'http-enhanced' })
    const contribution = () => Object.assign(
      (inner: Context) => { plugin.apply(inner, plugin.Config({})) },
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

  it('formats allowlist prompt guidance correctly', () => {
    expect(plugin.formatAllowlistPrompt({})).toBe('')
    expect(plugin.formatAllowlistPrompt({ allowCidrs: [] })).toBe('')
    expect(plugin.formatAllowlistPrompt({ allowCidrs: ['10.0.0.0/8'] }))
      .toContain('CIDRs: 10.0.0.0/8')
    expect(plugin.formatAllowlistPrompt({ allowHostnames: ['internal.corp'] })).toBe('')
    expect(plugin.formatAllowlistPrompt({ allowCidrs: [], allowHostnames: ['*.internal.corp'] })).toBe('')
    const full = plugin.formatAllowlistPrompt({
      allowCidrs: ['10.0.0.0/8', '192.168.0.0/16'],
      allowHostnames: ['*.internal.corp'],
    })
    expect(full).toContain('CIDRs: 10.0.0.0/8, 192.168.0.0/16')
    expect(full).toContain('hostnames: *.internal.corp')
    expect(full).toContain('The operator has explicitly authorized web_fetch access')
    expect(full).toContain('requires BOTH an address within those CIDRs AND a URL hostname')
    expect(full).toContain('do not independently authorize any non-public address')
    expect(full).toContain('All other URL, DNS, redirect, and transport safety checks still apply.')
  })

  it('registers systemPrompt section dynamically when systemPrompt service is available', async () => {
    const registeredSections: Array<{ name: string; order: number; text: () => string }> = []
    const section = vi.fn((sec: { name: string; order: number; text: () => string }) => {
      registeredSections.push(sec)
      return () => {}
    })

    class MockPromptService extends Service {
      constructor(c: Context) {
        super(c, 'systemPrompt')
      }
      section(sec: { name: string; order: number; text: () => string }) {
        return section(sec)
      }
    }

    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: 'http-enhanced' })
    const promptFiber = ctx.plugin(MockPromptService)
    await promptFiber.await()

    const fiber = ctx.plugin(plugin, {
      allowCidrs: ['10.0.0.0/8'],
    })
    await fiber.await()

    expect(section).toHaveBeenCalledTimes(1)
    expect(registeredSections[0]?.name).toBe('web-fetch-enhanced:allowlist')
    expect(registeredSections[0]?.order).toBe(2105)
    expect(registeredSections[0]?.text()).toContain('CIDRs: 10.0.0.0/8')
  })
})
