/**
 * The provider this plugin registers in `ctx.web`, and the backends behind it.
 *
 * DSH routes `web_fetch` to exactly one registered fetch provider, chosen by
 * the shared `web.fetchProvider` setting. This plugin occupies that one seat
 * and serves each request through a backend of its own: today the local
 * provider; later remote readers or the official DeepSeek Fetch API. Adding a
 * backend therefore never touches the Host composition — it adds an entry
 * below and a volatile selection field read in `selected`.
 */
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import { createLocalProvider, type LocalFetchSettings } from './local/index.ts'

/** Settings every backend may read, snapshotted once per request. */
export type FetchSettings = LocalFetchSettings

/**
 * @param id - the id registered in `ctx.web`.
 * @param read - returns the settings for the next request.
 * @returns the provider `ctx.web` calls.
 */
export function createFetchService(id: string, read: () => FetchSettings): WebFetchProvider {
  const backends = { local: createLocalProvider(read) } satisfies Record<string, WebFetchProvider>
  const selected = (): WebFetchProvider => backends.local
  return {
    id,
    available: () => selected().available(),
    fetch: (request, signal) => selected().fetch(request, signal),
  }
}
