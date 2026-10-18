import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createElement, useSyncExternalStore } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { SettingsPage, type SettingsPageProps } from '../src/client/SettingsPage.tsx'
import { SettingsPageController, type SettingsPageState } from '../src/client/settings-page.ts'

type Values = Record<string, unknown>

const DEFAULTS = { allowCidrs: [], allowHostnames: [], userAgent: 'native-agent', timeoutMs: 30_000, maxResponseBytes: 5_000_000, maxBodyChars: 100_000, maxRedirects: 5 }

/** A Host-backed configuration form that applies writes the way Settings does. */
function hostForm<T extends object>(initial: Partial<ConfigFormSnapshot<T>>) {
  let state = { status: 'ready', writable: true, revision: 1, value: undefined, base: undefined, user: {}, ...initial } as ConfigFormSnapshot<T>
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ConfigFormSnapshot<T>>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const mutate = vi.fn<ConfigForm<T>['mutate']>(async (ops, revision) => {
    if (revision !== undefined && revision !== state.revision) return false
    const user = { ...(state.user as Values) }
    for (const op of ops) {
      if (op.op === 'set') user[op.path[0]!] = op.value
      else delete user[op.path[0]!]
    }
    act(() => { publish({ user, value: { ...(state.base as T), ...user }, revision: state.revision! + 1 }) })
    return true
  })
  const form: ConfigForm<T> = {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate,
    set: vi.fn(),
    unset: vi.fn(),
  }
  return { form, mutate, publish: (patch: Partial<ConfigFormSnapshot<T>>) => { act(() => { publish(patch) }) } }
}

const t = (key: keyof typeof en, params: Record<string, unknown> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)

function mount(user: Values = {}, fetchProvider = 'http') {
  const plugin = hostForm<Values>({ base: DEFAULTS, user, value: { ...DEFAULTS, ...user } })
  const web = hostForm<{ fetchProvider?: string }>({ value: { fetchProvider } })
  const controller = new SettingsPageController(plugin.form, web.form)
  const face = controller.face()
  const store = face.hooks.settingsPage
  function Page() {
    const props = {
      ...face,
      t,
      useSettingsPage: <S,>(select: (state: SettingsPageState) => S) =>
        select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    } as unknown as SettingsPageProps
    return createElement(SettingsPage, props)
  }
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(createElement(Page)) })
  onTestFinished(() => { act(() => { renderer.unmount() }); controller.dispose() })

  const textareas = () => renderer.root.findAllByType('textarea')
  const type = (target: ReactTestInstance, text: string) => { act(() => { target.props.onChange({ target: { value: text } }) }) }
  const button = (label: string) => renderer.root.findAll(node => node.type === 'button' && textOf(node).includes(label))[0]!
  const click = async (label: string) => { await act(async () => { button(label).props.onClick() }) }
  const text = () => textOf(renderer.root)
  return { plugin, web, textareas, type, button, click, text, input: (id: string) => renderer.root.find(node => node.type === 'input' && node.props.id === id) }
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join(' ')
}

describe('settings page', () => {
  it('saves every edited field in one revision-fenced write', async () => {
    const page = mount()
    page.type(page.textareas()[0]!, '198.18.0.0/15\n')
    page.type(page.input('web-fetch-enhanced-user-agent'), 'custom/1.0')
    await page.click(en.save)
    expect(page.plugin.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'set', path: ['userAgent'], value: 'custom/1.0' },
    ], 1)
    expect(page.textareas()[0]!.props.value).toBe('198.18.0.0/15')
  })

  it('stores an emptied list as an explicit override, and Reset removes it', async () => {
    const page = mount({ allowCidrs: ['10.0.0.0/8'] })
    expect(page.text()).toContain(en.overridden)
    page.type(page.textareas()[0]!, '')
    await page.click(en.save)
    expect(page.plugin.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['allowCidrs'], value: [] }], 1)
    await page.click(en.reset)
    await page.click(en.save)
    expect(page.plugin.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['allowCidrs'] }], 2)
  })

  it('explains a refused line, blocks saving, and applies its fix', async () => {
    const page = mount()
    page.type(page.textareas()[0]!, '10.0.0.0/8\n198.18.1.1/15')
    expect(page.text()).toContain(en.problemHostBits)
    expect(page.button(en.save).props.disabled).toBe(true)
    await page.click('Use 198.18.0.0/15')
    expect(page.textareas()[0]!.props.value).toBe('10.0.0.0/8\n198.18.0.0/15')
    expect(page.button(en.save).props.disabled).toBe(false)
  })

  it('warns about risky ranges without blocking them', () => {
    const page = mount()
    page.type(page.textareas()[0]!, '169.254.0.0/16')
    expect(page.text()).toContain(en.warningMetadata)
    expect(page.button(en.save).props.disabled).toBe(false)
  })

  it('adds the fake-IP range in one click', async () => {
    const page = mount()
    await page.click(en.presetFakeIp)
    expect(page.textareas()[0]!.props.value).toBe('198.18.0.0/15')
    expect(page.text()).not.toContain(en.presetFakeIp)
  })

  it('keeps drafts after a refused save and retries against the current revision', async () => {
    const page = mount()
    page.plugin.mutate.mockResolvedValueOnce(false)
    page.type(page.textareas()[1]!, 'wiki.example.com')
    await page.click(en.save)
    expect(page.text()).toContain(en.saveFailed)
    expect(page.textareas()[1]!.props.value).toBe('wiki.example.com')
    page.plugin.publish({ revision: 5 })
    await page.click(en.save)
    expect(page.plugin.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['allowHostnames'], value: ['wiki.example.com'] }], undefined)
  })

  it('says when another provider serves web_fetch and how to switch back', () => {
    const page = mount({}, 'deepseek-fetch-api')
    expect(page.text()).toContain(t('routeOther', { id: 'deepseek-fetch-api' }))
    expect(page.text()).toContain(en.routeOtherDeepSeek)
    page.web.publish({ value: { fetchProvider: 'http' } })
    expect(page.text()).not.toContain(en.routeOtherDeepSeek)
  })
})
