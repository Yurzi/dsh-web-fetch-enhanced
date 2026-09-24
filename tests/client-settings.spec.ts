import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { describe, expect, it, vi } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { AllowlistCard, AllowlistPage, buildSaveOps, formatLines, isDirty, layerValues, parseLines, saveAllowlist } from '../src/client/AllowlistCard.tsx'

function formFixture(): ConfigPageForm {
  return {
    state: { status: 'ready', writable: true, mode: 'host', revision: 7,
      value: { allowCidrs: [], allowHostnames: [] },
      base: { allowCidrs: ['10.0.0.0/8'], allowHostnames: ['internal.example'] },
      user: { allowCidrs: [], allowHostnames: [] },
    },
    mutate: vi.fn(async () => true),
  }
}

describe('allowlist profile configuration helpers', () => {
  it('normalizes entries while preserving order and detecting duplicates', () => {
    expect(parseLines(' 10.0.0.0/8 \r\n\n*.example.test\n')).toEqual({ values: ['10.0.0.0/8', '*.example.test'], duplicate: false })
    expect(parseLines('10.0.0.0/8\n10.0.0.0/8')).toEqual({ values: ['10.0.0.0/8'], duplicate: true })
    expect(formatLines(['a', 'b'])).toBe('a\nb')
    expect(formatLines(undefined)).toBe('')
  })

  it('narrows profile values without trusting malformed data', () => {
    expect(layerValues({ allowCidrs: ['10.0.0.0/8'] }, 'allowCidrs')).toEqual(['10.0.0.0/8'])
    for (const value of [null, undefined, {}, { allowCidrs: 'x' }, { allowCidrs: [1] }]) {
      expect(layerValues(value, 'allowCidrs')).toBeUndefined()
    }
  })

  it('keeps Chinese and English dictionaries paired', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(en.reset).toContain('inherited')
  })

  it('writes explicit empty overrides rather than reviving inherited allowlists', () => {
    expect(buildSaveOps({ cidrs: [], hostnames: [] })).toEqual([
      { op: 'set', path: ['allowCidrs'], value: [] },
      { op: 'set', path: ['allowHostnames'], value: [] },
    ])
    expect(buildSaveOps({ cidrs: ['198.18.0.0/15'], hostnames: [] })).toEqual([
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'set', path: ['allowHostnames'], value: [] },
    ])
  })

  it('unsets only on explicit reset to inherited configuration', () => {
    expect(buildSaveOps({ cidrs: ['10.0.0.0/8'], hostnames: ['internal.example'] }, true)).toEqual([
      { op: 'unset', path: ['allowCidrs'] },
      { op: 'unset', path: ['allowHostnames'] },
    ])
  })

  it('copies input arrays and touches no unrelated profile configuration', () => {
    const cidrs = ['10.0.0.0/8']
    const ops = buildSaveOps({ cidrs, hostnames: ['internal.example'] })
    cidrs.push('127.0.0.0/8')
    expect(ops).toEqual([
      { op: 'set', path: ['allowCidrs'], value: ['10.0.0.0/8'] },
      { op: 'set', path: ['allowHostnames'], value: ['internal.example'] },
    ])
  })

  it('does not mark explicit empty profile overrides as redundant or dirty', () => {
    const clean = { cidrs: '', hostnames: '', resolvedCidrs: '', resolvedHostnames: '' }
    expect(isDirty(clean)).toBe(false)
    expect(isDirty({ ...clean, cidrs: '10.0.0.0/8' })).toBe(true)
    expect(isDirty({ ...clean, hostnames: 'internal.example' })).toBe(true)
    expect(isDirty({ ...clean, resetToInherited: true })).toBe(true)
  })
})

describe('profile form save contract', () => {
  const ops = buildSaveOps({ cidrs: [], hostnames: [] })

  it('submits one atomic write fenced at the draft revision', async () => {
    const form = formFixture()
    await expect(saveAllowlist(form, ops, 5)).resolves.toBe(true)
    expect(form.mutate).toHaveBeenCalledExactlyOnceWith(ops, 5)
  })

  it('treats false as rejection even when the recovered profile already matches the draft', async () => {
    const form = formFixture()
    vi.mocked(form.mutate).mockResolvedValue(false)
    await expect(saveAllowlist(form, ops, 7)).resolves.toBe(false)
  })

  it('converts transport rejection into a failed save', async () => {
    const form = formFixture()
    vi.mocked(form.mutate).mockRejectedValue(new Error('connection lost'))
    await expect(saveAllowlist(form, ops, 7)).resolves.toBe(false)
  })

  it('refuses unavailable, loading, read-only and unfenced writes', async () => {
    for (const state of [
      { status: 'unavailable' as const }, { status: 'loading' as const }, { writable: false },
    ]) {
      const form = formFixture()
      Object.assign(form.state, state)
      await expect(saveAllowlist(form, ops, 7)).resolves.toBe(false)
      expect(form.mutate).not.toHaveBeenCalled()
    }
    const form = formFixture()
    await expect(saveAllowlist(form, ops, undefined)).resolves.toBe(false)
    expect(form.mutate).not.toHaveBeenCalled()
  })
})

describe('Profile configuration page availability', () => {
  const t = (key: keyof typeof en) => en[key]
  it('renders the summary without requiring a form', () => {
    expect(AllowlistPage({ view: 'summary', t }).props.children).toBe(en.description)
  })
  it('does not fall back to another entry when the owner has no form', () => {
    const output = AllowlistPage({ view: 'page', t })
    expect(output.type).toBe('p')
    expect(output.props.role).toBe('status')
    expect(output.props.children).toBe(en.unavailable)
  })
  it('shows a loading status until the form is ready', () => {
    const form = formFixture()
    form.state.status = 'loading'
    expect(AllowlistPage({ view: 'page', form, t }).props.children).toBe(en.loading)
  })
  it('passes the exact owner form to the card', () => {
    const form = formFixture()
    const output = AllowlistPage({ view: 'page', form, t })
    expect(output.type).toBe(AllowlistCard)
    expect(output.props.form).toBe(form)
  })
  it('does not render an editable card for an unavailable form', () => {
    const form = formFixture()
    form.state.status = 'unavailable'
    expect(AllowlistPage({ view: 'page', form, t }).props.children).toBe(en.unavailable)
  })
})
