import z from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_USER_AGENT } from '../src/index.ts'

/** Reproduce Settings' volatile projection and callback-free JSON transport. */
function browserForm(): z {
  const fields = Object.fromEntries(Object.entries(Config.dict!).flatMap(([key, field]) => {
    if (!field.meta.volatile) return []
    const plain = new z(field.toJSON())
    delete plain.meta.volatile
    return [[key, plain]]
  }))
  const wire = JSON.stringify(z.object(fields).toJSON(), (key, value: unknown) => key === 'callback' ? undefined : value)
  return new z(JSON.parse(wire) as z)
}

describe('configuration schema across the Host/browser transport', () => {
  it('accepts defaults and saved allowlists after callback removal', () => {
    const form = browserForm()
    expect(form({})).toEqual({
      allowCidrs: [], allowHostnames: [], maxResponseBytes: 5_000_000,
      maxBodyChars: 100_000, timeoutMs: 30_000, maxRedirects: 5, userAgent: DEFAULT_USER_AGENT,
    })
    expect(form({ allowCidrs: ['198.18.0.0/15'], allowHostnames: ['*.example.com'] })).toMatchObject({
      allowCidrs: ['198.18.0.0/15'], allowHostnames: ['*.example.com'],
    })
    expect(form.dict).not.toHaveProperty('providerId')
    expect(form.dict!.allowCidrs!.type).toBe('array')
    expect(form.dict!.timeoutMs!.type).toBe('number')
  })

  it.each([
    { allowCidrs: '198.18.0.0/15' }, { allowHostnames: [123] },
    { maxResponseBytes: 0 }, { maxBodyChars: -1 }, { timeoutMs: 2_147_483_648 },
    { maxRedirects: 1.5 }, { userAgent: 'bad\r\nheader' },
  ])('keeps browser-side type and bound checks: %j', (invalid) => {
    expect(() => browserForm()(invalid)).toThrow()
  })

  it('keeps serialization stable without changing Host live references or validation', () => {
    const before = JSON.stringify(Config.toJSON())
    browserForm()
    expect(JSON.stringify(Config.toJSON())).toBe(before)
    const config = Config({ allowCidrs: ['127.0.0.1/32'] })
    expect(config.allowCidrs.get()).toEqual(['127.0.0.1/32'])
    expect(config.timeoutMs.get()).toBe(30_000)
    for (const candidate of [
      { allowCidrs: ['127.1/8'] }, { allowCidrs: ['10.1.2.3/8'] },
      { allowHostnames: ['https://example.com/path'] },
      { maxBodyChars: Number.NaN },
    ]) {
      expect(() => Config(candidate)).toThrow()
      // ConfigEditor and Loader preflight through the Standard Schema API.
      expect(() => Config['~standard'].validate(candidate)).toThrow()
    }
    expect(Config['~standard'].validate({ maxResponseBytes: Number.POSITIVE_INFINITY })).toHaveProperty('issues')
  })
})
