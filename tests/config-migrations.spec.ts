import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMA_VERSION, Config, createProvider, migrateConfig } from '../src/index.ts'

function expectRejected(input: unknown, message: RegExp) {
  expect(() => Config(input)).toThrow(message)
  expect(() => Config['~standard'].validate(input)).toThrow(message)
}

describe('configuration version migrations', () => {
  it.each([undefined, {}, { schemaVersion: 0 }, { schemaVersion: 1 }])('normalizes %j to v1', (raw) => {
    expect(migrateConfig(raw)).toEqual({ schemaVersion: CONFIG_SCHEMA_VERSION })
    expect(Config(raw).schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    expect(Config['~standard'].validate(raw)).toHaveProperty('value.schemaVersion', CONFIG_SCHEMA_VERSION)
  })

  it('is idempotent and preserves unknown fields, empty overrides and input ownership', () => {
    const input = Object.freeze({
      allowCidrs: Object.freeze([]), allowHostnames: Object.freeze(['*.example.com']),
      timeoutMs: 1234, extension: Object.freeze({ nested: Object.freeze(['keep']) }),
    })
    const migrated = migrateConfig(input)
    expect(migrated).toEqual({ ...input, schemaVersion: 1 })
    expect(migrateConfig(migrated)).toEqual(migrated)
    expect(migrated.extension).not.toBe(input.extension)
    expect(migrated.allowHostnames).not.toBe(input.allowHostnames)
    expect(input).not.toHaveProperty('schemaVersion')
    expect(Config(input).allowCidrs.get()).toEqual([])
    expect(input).not.toHaveProperty('providerId')
  })

  it.each([null, [], '1', 1, true])('rejects non-object config %j', (raw) => {
    expectRejected(raw, /config must be an object/u)
  })

  it.each([null, '1', -1, 0.5, true, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed version %j without modifying the candidate', (schemaVersion) => {
      const input = { schemaVersion, allowCidrs: ['127.0.0.1/32'] }
      const before = structuredClone(input)
      expectRejected(input, /schemaVersion must be/u)
      expect(input).toEqual(before)
    },
  )

  it('rejects future configurations instead of downgrading or falling back to defaults', () => {
    const input = { schemaVersion: 2, allowCidrs: ['127.0.0.1/32'] }
    expectRejected(input, /newer than supported.*upgrade the plugin/u)
    expect(() => createProvider(input)).toThrow(/newer than supported/u)
    expect(input.schemaVersion).toBe(2)
  })

  it('validates migrated data before producing a runtime config', () => {
    const input = { schemaVersion: 0, allowCidrs: ['not-a-cidr'] }
    expect(() => Config(input)).toThrow()
    expect(() => Config['~standard'].validate(input)).toThrow()
    expect(() => createProvider(input)).toThrow()
    expect(input).toEqual({ schemaVersion: 0, allowCidrs: ['not-a-cidr'] })
  })

  it('keeps the version outside the live editable form schema', () => {
    expect(Config.type).toBe('object')
    expect(Config.dict!.schemaVersion!.meta.volatile).not.toBe(true)
    expect(Config.dict!.allowCidrs!.meta.volatile).toBe(true)
    expect(createProvider({ schemaVersion: 0 }).id).toBe('http-enhanced')
    expect(createProvider({ schemaVersion: 1 }).id).toBe('http-enhanced')
  })
})
