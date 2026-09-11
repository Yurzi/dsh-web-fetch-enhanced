import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { Context } from '@deepseek-ai/cordis'
import { AllowlistCard, type AllowlistSettings } from './AllowlistCard.tsx'
import { en, zh, type LocaleKey } from './locales.ts'

const SETTINGS_NAMESPACE = 'web-fetch-enhanced'
const LOCALE_NAMESPACE = 'settings.webFetchEnhanced'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.webFetchEnhanced': LocaleKey
  }
}

export const name = 'web-fetch-enhanced-client'
export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: Context): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }), 'web-fetch-enhanced: settings dictionaries')
  const scope = ctx.settingsScope.bind<AllowlistSettings>({ namespace: SETTINGS_NAMESPACE })

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    locale: LOCALE_NAMESPACE,
    inject: () => ({ scope, t }),
  }, AllowlistCard))
}

export { AllowlistCard, parseLines, buildSaveOps, checkAccepted, isDirty, isRedundantUserField, hasLayerField, layerValues, equalValues } from './AllowlistCard.tsx'
export type { AllowlistCardProps, AllowlistSettings, SettingsPathOp, DirtyCheckParams } from './AllowlistCard.tsx'
