import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { AllowlistBundlePage } from '../src/client/AllowlistCard.tsx'
import { en } from '../src/client/locales.ts'

type Values = Record<string, unknown>

async function mount(writable = true) {
  let state: ConfigFormSnapshot<Values> = {
    status: 'ready', writable, mode: 'host', revision: 1,
    value: { allowCidrs: [], allowHostnames: [] }, user: {},
    base: { allowCidrs: ['10.0.0.0/8'], allowHostnames: ['*.internal.test'] },
  }
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const mutate = vi.fn<ConfigForm<Values>['mutate']>(async (ops, revision) => {
    if (revision !== state.revision) return false
    const value = { ...state.value }
    for (const op of ops) {
      const field = op.path[0]!
      value[field] = op.op === 'set' ? op.value : (state.base as Values)[field]
    }
    publish({ value, revision: state.revision! + 1 })
    return true
  })
  const form: ConfigForm<Values> = {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate, set: vi.fn(), unset: vi.fn(),
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(AllowlistBundlePage, { configForm: form, t: key => en[key] }))
  })
  onTestFinished(() => { act(() => { renderer.unmount() }); expect(listeners.size).toBe(0) })
  const input = (index: number) => renderer.root.findAllByType('textarea')[index]!.props as {
    value: string; disabled: boolean; 'aria-invalid'?: boolean
    onChange: (event: { target: { value: string } }) => void
  }
  const button = (label: string) => renderer.root.findAllByType('button')
    .find(node => node.props.children === label)!.props as { disabled: boolean; onClick: () => void }
  const edit = (index: number, value: string) => { act(() => { input(index).onChange({ target: { value } }) }) }
  const click = async (label: string) => { await act(async () => { button(label).onClick() }) }
  const update = (patch: Partial<typeof state>) => { act(() => { publish(patch) }) }
  const text = () => JSON.stringify(renderer.toJSON())
  return { renderer, form, mutate, input, button, edit, click, update, text }
}

describe('bundle allowlist form interactions', () => {
  it('saves both fields together and keeps them visible with success feedback', async () => {
    const ui = await mount()
    expect(ui.button(en.save).disabled).toBe(true)
    await ui.click(en.save)
    expect(ui.mutate).not.toHaveBeenCalled()
    ui.edit(0, '198.18.0.0/15')
    ui.edit(1, '*.example.test')
    expect(ui.text()).toContain(en.unsaved)
    await ui.click(en.save)
    expect(ui.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'set', path: ['allowHostnames'], value: ['*.example.test'] },
    ], 1)
    expect(ui.input(0).value).toBe('198.18.0.0/15')
    expect(ui.input(1).value).toBe('*.example.test')
    expect(ui.text()).toContain(en.saved)
    expect(ui.button(en.save).disabled).toBe(true)
  })

  it('blocks duplicate entries in either field and lets the user discard edits', async () => {
    const ui = await mount()
    for (const [index, value] of [[0, '10.0.0.0/8'], [1, 'internal.test']] as const) {
      ui.edit(index, `${value}\n${value}`)
      expect(ui.input(index)['aria-invalid']).toBe(true)
      expect(ui.text()).toContain(en.duplicate)
      await ui.click(en.save)
      expect(ui.mutate).not.toHaveBeenCalled()
      await ui.click(en.discard)
      expect(ui.input(index).value).toBe('')
    }
  })

  it('stages inherited defaults until saved and treats subsequent edits as explicit overrides', async () => {
    const ui = await mount()
    await ui.click(en.reset)
    expect(ui.mutate).not.toHaveBeenCalled()
    expect(ui.input(0).value).toBe('10.0.0.0/8')
    expect(ui.input(1).value).toBe('*.internal.test')
    await ui.click(en.save)
    expect(ui.mutate).toHaveBeenLastCalledWith([
      { op: 'unset', path: ['allowCidrs'] }, { op: 'unset', path: ['allowHostnames'] },
    ], 1)
    await ui.click(en.reset)
    ui.edit(0, '')
    ui.edit(1, '')
    await ui.click(en.save)
    expect(ui.mutate).toHaveBeenLastCalledWith([
      { op: 'set', path: ['allowCidrs'], value: [] }, { op: 'set', path: ['allowHostnames'], value: [] },
    ], 2)
  })

  it('refreshes clean forms but preserves stale drafts and refuses their writes', async () => {
    const ui = await mount()
    ui.update({ value: { allowCidrs: ['10.0.0.0/8'] }, revision: 2 })
    expect(ui.input(0).value).toBe('10.0.0.0/8')
    ui.edit(0, '192.168.0.0/16')
    ui.update({ value: { allowCidrs: ['172.16.0.0/12'] }, revision: 3 })
    expect(ui.input(0).value).toBe('192.168.0.0/16')
    await ui.click(en.save)
    expect(ui.mutate.mock.calls[0]?.[1]).toBe(2)
    expect(ui.text()).toContain(en.failed)
    await ui.click(en.discard)
    expect(ui.input(0).value).toBe('172.16.0.0/12')
    ui.edit(1, 'internal.test')
    await ui.click(en.save)
    expect(ui.mutate.mock.calls[1]?.[1]).toBe(3)
  })

  it('retains drafts on transport errors and can retry after discarding', async () => {
    const ui = await mount()
    ui.mutate.mockRejectedValueOnce(new Error('offline'))
    ui.edit(0, '10.0.0.0/8')
    await ui.click(en.save)
    expect(ui.text()).toContain(en.failed)
    expect(ui.input(0).value).toBe('10.0.0.0/8')
    await ui.click(en.discard)
    expect(ui.text()).not.toContain(en.failed)
    expect(ui.input(0).value).toBe('')
  })

  it('locks controls while saving and never submits a second write', async () => {
    const ui = await mount()
    let settle!: (accepted: boolean) => void
    ui.mutate.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    ui.edit(0, '10.0.0.0/8')
    await ui.click(en.save)
    expect(ui.input(0).disabled).toBe(true)
    expect(ui.button(en.saving).disabled).toBe(true)
    await ui.click(en.saving)
    await ui.click(en.reset)
    expect(ui.mutate).toHaveBeenCalledTimes(1)
    await act(async () => { settle(false) })
    expect(ui.input(0).disabled).toBe(false)
    expect(ui.text()).toContain(en.failed)
  })

  it('shows read-only, loading and unavailable states without writable controls', async () => {
    const ui = await mount(false)
    expect(ui.input(0).disabled).toBe(true)
    expect(ui.text()).toContain(en.readOnly)
    await ui.click(en.reset)
    expect(ui.mutate).not.toHaveBeenCalled()
    ui.update({ status: 'loading' })
    expect(ui.text()).toContain(en.loading)
    expect(ui.renderer.root.findAllByType('textarea')).toHaveLength(0)
    ui.update({ status: 'unavailable' })
    expect(ui.text()).toContain(en.unavailable)
    ui.update({ status: 'ready', writable: true })
    expect(ui.input(0).disabled).toBe(false)
  })
})
