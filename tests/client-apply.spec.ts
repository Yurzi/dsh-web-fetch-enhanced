import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/client/index.ts'

describe('browser settings plugin registration', () => {
  it('registers a bilingual card under the Host settings namespace key', () => {
    const registerLocale = vi.fn(() => () => {})
    const bind = vi.fn(() => (key: string) => key)
    const scope = { getSnapshot: vi.fn(), subscribe: vi.fn(), set: vi.fn(), unset: vi.fn() }
    const register = vi.fn((_options: unknown, _component: unknown) => () => {})
    const injectSlot = vi.fn((_slot: string, install: () => unknown) => install())
    const ctx = {
      locale: { bind, register: registerLocale },
      settingsScope: { bind: vi.fn(() => scope) },
      slots: { inject: injectSlot, register },
      effect: (install: () => unknown) => install(),
    }

    apply(ctx as never)

    expect(name).toBe('web-fetch-enhanced-client')
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
    expect(registerLocale).toHaveBeenCalledWith('settings.webFetchEnhanced', expect.objectContaining({ en: expect.any(Object), zh: expect.any(Object) }))
    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({ namespace: 'web-fetch-enhanced' })
    expect(injectSlot).toHaveBeenCalledWith('settings.plugin.item', expect.any(Function))
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      name: 'settings.plugin.item',
      key: 'web-fetch-enhanced',
      locale: 'settings.webFetchEnhanced',
    })
  })
})
