import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import {
  buildSaveOps,
  checkAccepted,
  isDirty,
  isRedundantUserField,
  parseLines,
  type SettingsPathOp,
} from '../src/client/AllowlistCard.tsx'

describe('allowlist settings card helpers', () => {
  it('normalizes one entry per line while preserving order', () => {
    expect(parseLines(' 10.0.0.0/8 \n\n*.example.test\n')).toEqual({
      values: ['10.0.0.0/8', '*.example.test'],
      duplicate: false,
    })
  })

  it('reports duplicate entries instead of silently accepting them', () => {
    expect(parseLines('10.0.0.0/8\n10.0.0.0/8')).toEqual({
      values: ['10.0.0.0/8'],
      duplicate: true,
    })
  })

  it('keeps Chinese and English dictionaries structurally paired', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(zh.title).toBe('Web Fetch Enhanced')
    expect(en.title).toBe('Web Fetch Enhanced')
  })
})

describe('buildSaveOps (sparse save and legacy pruning)', () => {
  it('generates a set for allowCidrs and an unset for allowHostnames when CIDR is provided but Hostnames is empty', () => {
    const ops = buildSaveOps({ cidrs: ['198.18.0.0/15'], hostnames: [] })
    expect(ops).toEqual([
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'unset', path: ['allowHostnames'] },
    ])
  })

  it('generates unset for both when both are empty', () => {
    const ops = buildSaveOps({ cidrs: [], hostnames: [] })
    expect(ops).toEqual([
      { op: 'unset', path: ['allowCidrs'] },
      { op: 'unset', path: ['allowHostnames'] },
    ])
  })

  it('generates set for both when both are provided', () => {
    const ops = buildSaveOps({ cidrs: ['198.18.0.0/15'], hostnames: ['api.example.com'] })
    expect(ops).toEqual([
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'set', path: ['allowHostnames'], value: ['api.example.com'] },
    ])
  })

  it('generates unset for both when resetToProfile is true regardless of input', () => {
    const ops = buildSaveOps(
      { cidrs: ['198.18.0.0/15'], hostnames: ['api.example.com'] },
      undefined,
      true,
    )
    expect(ops).toEqual([
      { op: 'unset', path: ['allowCidrs'] },
      { op: 'unset', path: ['allowHostnames'] },
    ])
  })

  it('prunes legacy redundant allowHostnames: [] when saving CIDRs only', () => {
    const legacyUser = { allowCidrs: ['198.18.0.0/15'], allowHostnames: [] }
    const ops = buildSaveOps({ cidrs: ['198.18.0.0/15'], hostnames: [] }, legacyUser)
    expect(ops).toEqual([
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'unset', path: ['allowHostnames'] },
    ])
  })

  it('prunes both legacy redundant empty arrays when saving empty allowlists', () => {
    const legacyUser = { allowCidrs: [], allowHostnames: [] }
    const ops = buildSaveOps({ cidrs: [], hostnames: [] }, legacyUser)
    expect(ops).toEqual([
      { op: 'unset', path: ['allowCidrs'] },
      { op: 'unset', path: ['allowHostnames'] },
    ])
  })

  it('replaces legacy empty array in user layer when new values are provided', () => {
    const legacyUser = { allowCidrs: [], allowHostnames: [] }
    const ops = buildSaveOps({ cidrs: ['10.0.0.0/8'], hostnames: ['internal.corp'] }, legacyUser)
    expect(ops).toEqual([
      { op: 'set', path: ['allowCidrs'], value: ['10.0.0.0/8'] },
      { op: 'set', path: ['allowHostnames'], value: ['internal.corp'] },
    ])
  })
})

describe('checkAccepted', () => {
  it('accepts set operations when user layer matches expected values', () => {
    const user = { allowCidrs: ['198.18.0.0/15'], allowHostnames: ['api.example.com'] }
    const ops: SettingsPathOp[] = [
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'set', path: ['allowHostnames'], value: ['api.example.com'] },
    ]
    expect(checkAccepted(user, ops)).toBe(true)
  })

  it('accepts mixed set and unset operations when set matches and unset field is absent', () => {
    const user = { allowCidrs: ['198.18.0.0/15'] }
    const ops: SettingsPathOp[] = [
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'unset', path: ['allowHostnames'] },
    ]
    expect(checkAccepted(user, ops)).toBe(true)
  })

  it('accepts when both fields are unset and absent from user layer', () => {
    const user = {}
    const ops: SettingsPathOp[] = [
      { op: 'unset', path: ['allowCidrs'] },
      { op: 'unset', path: ['allowHostnames'] },
    ]
    expect(checkAccepted(user, ops)).toBe(true)
    expect(checkAccepted(undefined, ops)).toBe(true)
  })

  it('rejects unset operation if field is still present in user layer', () => {
    const user = { allowCidrs: ['198.18.0.0/15'], allowHostnames: [] }
    const ops: SettingsPathOp[] = [
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'unset', path: ['allowHostnames'] },
    ]
    expect(checkAccepted(user, ops)).toBe(false)
  })

  it('rejects set operation if values do not match user layer', () => {
    const user = { allowCidrs: ['10.0.0.0/8'] }
    const ops: SettingsPathOp[] = [
      { op: 'set', path: ['allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'unset', path: ['allowHostnames'] },
    ]
    expect(checkAccepted(user, ops)).toBe(false)
  })
})

describe('isDirty', () => {
  it('returns false when input matches resolved values and no redundant keys exist', () => {
    expect(isDirty({
      cidrs: '198.18.0.0/15',
      hostnames: '',
      resolvedCidrs: '198.18.0.0/15',
      resolvedHostnames: '',
      user: { allowCidrs: ['198.18.0.0/15'] },
    })).toBe(false)
  })

  it('returns true when cidrs input differs from resolved values', () => {
    expect(isDirty({
      cidrs: '10.0.0.0/8',
      hostnames: '',
      resolvedCidrs: '198.18.0.0/15',
      resolvedHostnames: '',
      user: { allowCidrs: ['198.18.0.0/15'] },
    })).toBe(true)
  })

  it('returns true when hostnames input differs from resolved values', () => {
    expect(isDirty({
      cidrs: '198.18.0.0/15',
      hostnames: 'api.example.com',
      resolvedCidrs: '198.18.0.0/15',
      resolvedHostnames: '',
      user: { allowCidrs: ['198.18.0.0/15'] },
    })).toBe(true)
  })

  it('returns true when resetToProfile is staged', () => {
    expect(isDirty({
      cidrs: '198.18.0.0/15',
      hostnames: '',
      resolvedCidrs: '198.18.0.0/15',
      resolvedHostnames: '',
      user: { allowCidrs: ['198.18.0.0/15'] },
      resetToProfile: true,
    })).toBe(true)
  })

  it('returns true when user layer has legacy redundant empty array needing unset', () => {
    // Legacy bloat: allowHostnames is present in user layer as []
    expect(isDirty({
      cidrs: '198.18.0.0/15',
      hostnames: '',
      resolvedCidrs: '198.18.0.0/15',
      resolvedHostnames: '',
      user: { allowCidrs: ['198.18.0.0/15'], allowHostnames: [] },
    })).toBe(true)
  })

  it('returns false when legacy prune was dismissed by clicking discard', () => {
    expect(isDirty({
      cidrs: '198.18.0.0/15',
      hostnames: '',
      resolvedCidrs: '198.18.0.0/15',
      resolvedHostnames: '',
      user: { allowCidrs: ['198.18.0.0/15'], allowHostnames: [] },
      dismissedPrune: true,
    })).toBe(false)
  })

  it('returns true when user clears an existing allowlist to empty', () => {
    expect(isDirty({
      cidrs: '',
      hostnames: '',
      resolvedCidrs: '198.18.0.0/15',
      resolvedHostnames: '',
      user: { allowCidrs: ['198.18.0.0/15'] },
    })).toBe(true)
  })
})

describe('isRedundantUserField', () => {
  it('identifies empty arrays in user layer as redundant defaults', () => {
    expect(isRedundantUserField({ allowHostnames: [] }, 'allowHostnames')).toBe(true)
    expect(isRedundantUserField({ allowCidrs: [] }, 'allowCidrs')).toBe(true)
    expect(isRedundantUserField({ allowHostnames: ['api.example.com'] }, 'allowHostnames')).toBe(false)
    expect(isRedundantUserField({}, 'allowHostnames')).toBe(false)
    expect(isRedundantUserField(undefined, 'allowHostnames')).toBe(false)
    expect(isRedundantUserField(null, 'allowHostnames')).toBe(false)
  })
})
