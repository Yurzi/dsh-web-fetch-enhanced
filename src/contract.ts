/**
 * Names and value rules shared by the Host and browser faces. Nothing here
 * imports Node or Host packages, so the settings page can enforce the same
 * rules the Host does before a save ever leaves the browser.
 */

/** npm package name; the Plugins page keys this bundle's configuration by it. */
export const PACKAGE_NAME = 'dsh-web-fetch-enhanced'

/** Profile row id the bundle patch inserts; the settings page edits exactly this row. */
export const ENTRY_ID = 'web-fetch-enhanced'

/**
 * Id this plugin registers in `ctx.web`. It replaces the native `http`
 * provider in place, so the Host's existing `web.fetchProvider: http` keeps
 * selecting it without the bundle rewriting the shared `web` row.
 */
export const DEFAULT_PROVIDER_ID = 'http'

/** Provider ids: a letter or digit, then up to 127 letters, digits, dots, underscores, or hyphens. */
export const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Node coerces longer timer delays to 1 ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** One HTTP header value: visible ASCII, space, and obs-text; no control characters. */
export const USER_AGENT_PATTERN = /^[\x20-\x7e\x80-\xff]*$/

/**
 * Whether a string can be sent as the `User-Agent` header. An empty value is
 * valid and sends an empty header.
 * @param value - the candidate header value.
 * @returns true when the value contains only header-safe characters.
 */
export function isValidUserAgent(value: string): boolean {
  return USER_AGENT_PATTERN.test(value)
}
