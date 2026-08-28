import { describe, expect, it } from 'vitest'
import {
  WEB_FETCH_MAX_URL_LENGTH,
  classifyContentType,
  decoderForCharset,
  isSameOrigin,
  parseCharset,
  parseFetchUrl,
  validateFetchUrl,
} from '../src/policy.ts'

describe('HTTP policy helpers', () => {
  it('accepts only anonymous HTTP(S) URLs within the fixed limit', () => {
    expect(parseFetchUrl('https://example.com/path').hostname).toBe('example.com')
    expect(() => parseFetchUrl('not a url')).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(() => parseFetchUrl('file:///etc/passwd')).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(() => parseFetchUrl('https://user:pass@example.com')).toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(() => validateFetchUrl(`https://example.com/${'a'.repeat(WEB_FETCH_MAX_URL_LENGTH)}`))
      .toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it('compares complete origins', () => {
    expect(isSameOrigin(new URL('https://a.test/x'), new URL('https://a.test/y'))).toBe(true)
    expect(isSameOrigin(new URL('https://a.test'), new URL('http://a.test'))).toBe(false)
    expect(isSameOrigin(new URL('https://a.test'), new URL('https://a.test:8443'))).toBe(false)
  })

  it('classifies only supported text-like MIME types', () => {
    expect(classifyContentType('text/html; charset=utf-8')).toBe('html')
    expect(classifyContentType('application/xhtml+xml')).toBe('html')
    expect(classifyContentType('text/plain')).toBe('text')
    expect(classifyContentType('application/json')).toBe('text')
    expect(classifyContentType('application/problem+json')).toBe('text')
    expect(classifyContentType('application/xml')).toBe('text')
    expect(classifyContentType('image/png')).toBeUndefined()
    expect(classifyContentType(null)).toBeUndefined()
  })

  it('parses and validates charset labels', () => {
    expect(parseCharset('text/plain; charset="GBK"')).toBe('gbk')
    expect(parseCharset('text/plain')).toBeUndefined()
    expect(decoderForCharset(undefined).encoding).toBe('utf-8')
    expect(decoderForCharset('utf-8').encoding).toBe('utf-8')
    expect(() => decoderForCharset('definitely-not-a-charset'))
      .toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })
})
