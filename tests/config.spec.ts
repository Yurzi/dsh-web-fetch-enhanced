import z from '@deepseek-ai/schemastery'
import { DEFAULT_USER_AGENT } from '@deepseek-ai/dsh-web-fetch-http'
import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMA_VERSION, Config, DEFAULT_PROVIDER_ID, migrateConfig } from '../src/index.ts'
import { MAX_TIMER_DELAY_MS } from '../src/contract.ts'

describe('Config', () => {
  it('takes the native provider seat and native defaults', () => {
    const config = Config({})
    expect(config.providerId).toBe(DEFAULT_PROVIDER_ID)
    expect(config.allowCidrs.get()).toEqual([])
    expect(config.userAgent.get()).toBe(DEFAULT_USER_AGENT)
    expect(config.timeoutMs.get()).toBe(30_000)
  })

  it.each([
    { allowCidrs: ['198.18.1.1/15'] },
    { allowHostnames: ['https://example.com'] },
    { userAgent: 'bad\r\nX-Injected: 1' },
    { timeoutMs: 0 },
    { timeoutMs: MAX_TIMER_DELAY_MS + 1 },
    { maxRedirects: 1.5 },
    { maxBodyChars: Number.NaN },
    { providerId: 'bad id' },
  ])('refuses %j', (candidate) => {
    expect(() => Config(candidate)).toThrow()
  })

  it('serializes a schema the browser can validate without Host callbacks', () => {
    // Settings sends the schema as JSON; transform callbacks do not survive the trip.
    const wire = new z(JSON.parse(JSON.stringify(Config.toJSON())) as z)
    expect(wire({}).allowCidrs.get()).toEqual([])
    expect(wire({}).userAgent.get()).toBe(DEFAULT_USER_AGENT)
    expect(wire({ allowCidrs: ['198.18.0.0/15'] }).allowCidrs.get()).toEqual(['198.18.0.0/15'])
  })
})

describe('config format versions', () => {
  it.each([undefined, {}, { schemaVersion: 0 }, { schemaVersion: 1 }])('reads %j as the current format', (raw) => {
    expect(Config(raw).schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
  })

  it('refuses a newer or malformed version instead of guessing', () => {
    expect(() => Config({ schemaVersion: 2 })).toThrow('newer than supported')
    expect(() => Config({ schemaVersion: '1' })).toThrow('schemaVersion must be')
  })

  it('migrates without touching the caller\'s object or dropping explicit empty lists', () => {
    const raw = Object.freeze({ allowCidrs: Object.freeze([]) })
    expect(migrateConfig(raw)).toEqual({ allowCidrs: [], schemaVersion: 1 })
    expect(raw).not.toHaveProperty('schemaVersion')
  })
})
