/**
 * Tell the model which non-public destinations the operator opened. Without
 * it, models trained on public-only fetch tools refuse intranet or fake-IP
 * URLs before trying them. The note is runtime context rather than a system
 * prompt section: it follows live edits and the Host's provider selection
 * without invalidating the cached system prompt.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { WebRuntimeConfig } from '@deepseek-ai/dsh-web'
import type { AllowlistRules } from './providers/local/index.ts'

/** The shipped composition's row id for `@deepseek-ai/dsh-web`, as the Web settings page also assumes. */
const WEB_ENTRY_ID = 'web'

/**
 * @param rules - the allowlist in force.
 * @returns the note, or the empty string when no exception is configured.
 */
export function allowlistNotice({ allowCidrs, allowHostnames }: AllowlistRules): string {
  if (allowCidrs.length === 0) return ''
  const scope = allowHostnames.length === 0
    ? ''
    : ` Only URLs whose hostname matches [${allowHostnames.join(', ')}] may use these exceptions.`
  return `The operator has authorized web_fetch to reach non-public addresses within [${allowCidrs.join(', ')}].${scope}`
    + ' All other URL, DNS, redirect, and transport safety checks still apply.'
}

/**
 * Register the note while `ctx.web` routes `web_fetch` to this plugin.
 * @param ctx - plugin context; the note leaves with its fiber.
 * @param providerId - the id this plugin registered.
 * @param read - returns the allowlist in force.
 */
export function registerAllowlistNotice(ctx: Context, providerId: string, read: () => AllowlistRules): void {
  ctx.inject(['systemPrompt'], (prompt) => {
    prompt.systemPrompt.context({
      name: 'web-fetch-enhanced:allowlist',
      // Reachability is sandbox policy for the network: keep the two together.
      order: prompt.systemPrompt.getContextOrder('SANDBOX_POLICY') + 1,
      interpolate: false,
      text: () => routesFetchTo(ctx, providerId) ? allowlistNotice(read()) : '',
    })
  })
}

/**
 * Whether the next `web_fetch` reaches `providerId`, judged the way `ctx.web`
 * selects: the `web` row's pinned `fetchProvider`, else
 * `$DSH_WEB_FETCH_PROVIDER`. The `web` row is looked up beside this plugin's
 * own row, since a Profile mounts its rows inside an include subtree. A
 * composition without a readable pin counts as yes.
 */
function routesFetchTo(ctx: Context, providerId: string): boolean {
  let web: Partial<WebRuntimeConfig> | undefined
  try {
    web = ctx.fiber.entry?.parent.tree.resolve(WEB_ENTRY_ID).fiber?.config
  } catch {
    // No sibling row with that id: a custom composition we cannot inspect.
  }
  const pinned = web?.fetchProvider?.get() ?? process.env.DSH_WEB_FETCH_PROVIDER
  return pinned === undefined || pinned === providerId
}
