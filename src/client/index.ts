/**
 * Browser face: the bundle's settings on its Plugins page, registered while
 * the Host serves this plugin's Profile row.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'
import { ENTRY_ID, PACKAGE_NAME } from '../contract.ts'
import { en, zh, type LocaleKey } from './locales.ts'
import { SettingsPage } from './SettingsPage.tsx'
import { SettingsPageController } from './settings-page.ts'
import css from './style.css?inline'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.webFetchEnhanced'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.webFetchEnhanced': LocaleKey
  }
}

export const name = 'web-fetch-enhanced-client'
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the settings page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'web-fetch-enhanced: dictionaries')
  ctx.effect(() => mountStylesheet(css), 'web-fetch-enhanced: stylesheet')
  const page = new SettingsPageController(ctx.configForms.get(ENTRY_ID), ctx.configForms.get('web'))
  ctx.effect(() => () => { page.dispose() }, 'web-fetch-enhanced: settings form')
  ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: NS, inject: () => page.face(),
  }, SettingsPage))), 'web-fetch-enhanced: settings page')
}

function mountStylesheet(text: string): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = PACKAGE_NAME
  style.textContent = text
  document.head.append(style)
  return () => { style.remove() }
}
