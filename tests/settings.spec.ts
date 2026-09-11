import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean { return true }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(base: plugin.Config = {}): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { fetchProvider: 'http-enhanced' })
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(plugin, base)
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

describe('Web Profile settings integration', () => {
  it('exposes the namespace and applies a stored allowlist to subsequent fetches', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-fetch-enhanced')

    await expect(bench.ctx.web.fetch({ url: 'http://127.0.0.1:1/' }))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })

    await bench.ctx.settings.update(plugin.SETTINGS_NAMESPACE, { allowCidrs: ['127.0.0.1/32'] })

    await expect(bench.ctx.web.fetch({ url: 'http://127.0.0.1:1/' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await bench.ctx.fiber.dispose()
  })

  it('rejects invalid allowlists and provider identity changes at the Host boundary', async () => {
    const bench = await boot()
    await expect(bench.ctx.settings.update(plugin.SETTINGS_NAMESPACE, { allowCidrs: ['not-a-cidr'] }))
      .rejects.toThrow('invalid CIDR')
    await expect(bench.ctx.settings.update(plugin.SETTINGS_NAMESPACE, { providerId: 'other' }))
      .rejects.toThrow('providerId cannot be changed')
    await bench.ctx.fiber.dispose()
  })

  it('falls back to composition settings and releases its namespace on disposal', async () => {
    const bench = await boot({ allowCidrs: ['127.0.0.1/32'] })
    await bench.ctx.settings.update(plugin.SETTINGS_NAMESPACE, { allowCidrs: [] })
    await expect(bench.ctx.web.fetch({ url: 'http://127.0.0.1:1/' }))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })

    await bench.settingsFiber.dispose()
    await expect(bench.ctx.web.fetch({ url: 'http://127.0.0.1:1/' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })

    const second = await boot()
    await second.pluginFiber.dispose()
    expect(second.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-fetch-enhanced')
    await bench.ctx.fiber.dispose()
    await second.ctx.fiber.dispose()
  })

  it('delegates to SettingsProvider.installSection when provided upstream', async () => {
    const spy = vi.spyOn(MemorySettings.prototype, 'installSection')

    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: 'http-enhanced' })
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber.await()
    const pluginFiber = ctx.plugin(plugin, {})
    await pluginFiber.await()

    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0]?.[1]).toBe(plugin.SETTINGS_NAMESPACE)
    expect(spy.mock.calls[0]?.[0]).toBeDefined()

    await ctx.fiber.dispose()
  })
})
