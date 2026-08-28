import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { parseLines } from '../src/client/AllowlistCard.tsx'

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
