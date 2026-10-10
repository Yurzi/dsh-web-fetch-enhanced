import z from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { Config, createProvider, DEFAULT_USER_AGENT } from '../src/index.ts'
import { isValidUserAgent } from '../src/user-agent.ts'
import { layerUserAgent, buildUserAgentOps } from '../src/client/UserAgentCard.tsx'

describe('User-Agent defaults and validation', () => {
  it('uses the official DSH default everywhere', () => {
    expect(DEFAULT_USER_AGENT).toBe('deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)')
    expect(Config({}).userAgent.get()).toBe(DEFAULT_USER_AGENT)
    expect(layerUserAgent({})).toBe(DEFAULT_USER_AGENT)
    expect(layerUserAgent(null)).toBe(DEFAULT_USER_AGENT)
  })

  it.each(['custom-agent/1.0', 'Mozilla/5.0 (X11; Linux x86_64)', '', 'latin-1/é'])('preserves valid explicit values: %j', userAgent => {
    expect(isValidUserAgent(userAgent)).toBe(true)
    expect(Config({ userAgent }).userAgent.get()).toBe(userAgent)
    expect(layerUserAgent({ userAgent })).toBe(userAgent)
    expect(() => createProvider({ userAgent })).not.toThrow()
  })

  it.each(['bad\r\nX-Header: injected', 'bad\n', 'bad\r', 'bad\t', 'bad\0', 'bad\x7f', '中文', '😀'])('rejects unsafe values in all configuration entry points: %j', userAgent => {
    expect(isValidUserAgent(userAgent)).toBe(false)
    expect(() => Config({ userAgent })).toThrow()
    expect(() => createProvider({ userAgent })).toThrow('userAgent')
    const browserField = new z(Config.dict!.userAgent!.toJSON())
    expect(() => browserField(userAgent)).toThrow()
  })

  it('writes and resets only the UA field; empty is not reset', () => {
    expect(buildUserAgentOps('')).toEqual([{ op: 'set', path: ['userAgent'], value: '' }])
    expect(buildUserAgentOps('custom')).toEqual([{ op: 'set', path: ['userAgent'], value: 'custom' }])
    expect(buildUserAgentOps('custom', true)).toEqual([{ op: 'unset', path: ['userAgent'] }])
  })
})
