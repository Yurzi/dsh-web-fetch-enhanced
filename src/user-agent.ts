/** Keep the anonymous HTTP default aligned with DSH web-fetch-http. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Existing header semantics: allow an explicit empty value, but no controls or non-Latin-1. */
// The final lookahead forbids the special JS `$` match before a trailing newline.
export const USER_AGENT_PATTERN = /^[\x20-\x7e\x80-\xff]*$(?![\s\S])/u

export function isValidUserAgent(value: unknown): value is string {
  return typeof value === 'string' && USER_AGENT_PATTERN.test(value)
}

export function assertUserAgent(value: unknown): asserts value is string {
  if (!isValidUserAgent(value)) {
    throw new Error('web-fetch-enhanced: userAgent must contain only HTTP header characters (no controls or non-Latin-1 characters)')
  }
}
