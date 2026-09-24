import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'
import { AllowlistBundlePage } from './AllowlistCard.tsx'
import { en, zh, type LocaleKey } from './locales.ts'

const LOCALE_NAMESPACE = 'settings.webFetchEnhanced'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.webFetchEnhanced': LocaleKey
  }
}

export const name = 'web-fetch-enhanced-client'
export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: Context): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }), 'web-fetch-enhanced: settings dictionaries')
  // Bundle pages receive no owner form. Bind only the entry declared by our patch.
  const configForm = ctx.configForms.get<Record<string, unknown>>('web-fetch-enhanced')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-web-fetch-enhanced',
    locale: LOCALE_NAMESPACE,
    inject: () => ({ t, configForm }),
  }, AllowlistBundlePage))
}

export { AllowlistCard, AllowlistPage, AllowlistBundlePage, parseLines, buildSaveOps, saveAllowlist, isDirty, layerValues } from './AllowlistCard.tsx'
export type { AllowlistCardProps, AllowlistSettings, SettingsPathOp, DirtyCheckParams } from './AllowlistCard.tsx'
