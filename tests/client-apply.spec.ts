import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name, AllowlistBundlePage } from '../src/client/index.ts'

describe('browser plugin bundle configuration registration', () => {
  it('registers configuration on the bundle page bound to its exact Profile entry', () => {
    const registerLocale = vi.fn(() => () => {})
    const t = (key: string) => key
    const bind = vi.fn(() => t)
    const register = vi.fn((_options: unknown, _component: unknown) => () => {})
    const injectSlot = vi.fn((_slot: string, install: () => unknown) => install())
    const configForm = { getSnapshot: vi.fn(), subscribe: vi.fn(), mutate: vi.fn() }
    const get = vi.fn(() => configForm)
    const ctx = {
      configForms: { get },
      locale: { bind, register: registerLocale },
      slots: { inject: injectSlot, register },
      effect: (install: () => unknown) => install(),
    }

    apply(ctx as never)

    expect(name).toBe('web-fetch-enhanced-client')
    expect(inject).toEqual(['slots', 'locale', 'configForms'])
    expect(registerLocale).toHaveBeenCalledWith('settings.webFetchEnhanced', expect.objectContaining({ en: expect.any(Object), zh: expect.any(Object) }))
    expect(injectSlot).toHaveBeenCalledWith('plugins.bundle.config', expect.any(Function))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'plugins.bundle.config',
      key: 'dsh-web-fetch-enhanced',
      locale: 'settings.webFetchEnhanced',
    }), AllowlistBundlePage)
    const options = register.mock.calls[0]?.[0] as { inject: () => unknown }
    // Bundle pages do not supply a form; use only the row declared by our patch.
    expect(get).toHaveBeenCalledExactlyOnceWith('web-fetch-enhanced')
    expect(options.inject()).toEqual({ t, configForm })
  })
})
