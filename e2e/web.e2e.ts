/**
 * The settings page in the real DSH Web GUI, driven like a user in headless
 * Chromium: open the plugin, type a rule the Host would refuse, take the
 * offered fix, save, and confirm the Profile on disk changed. Each test puts
 * the Profile back the way it found it.
 *
 * Needs a Chromium or Chrome binary: set DSH_E2E_CHROMIUM, otherwise common
 * system paths are tried and the suite is skipped when none exists.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Browser, type Page, chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { artifacts, composedRows } from './support/environment.ts'
import { type WebServer, startWeb } from './support/web.ts'

const e2e = inject('e2e')
const executablePath = [process.env.DSH_E2E_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((path): path is string => path !== undefined && existsSync(path))

describe.skipIf(executablePath === undefined)('settings page in DSH Web', () => {
  let server: WebServer
  let browser: Browser
  let page: Page
  const consoleErrors: string[] = []

  beforeAll(async () => {
    server = await startWeb(e2e)
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })).newPage()
    page.setDefaultTimeout(30_000)
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', (error) => { consoleErrors.push(error.message) })
    // A fresh home greets the user with dialogs that would cover the page.
    await page.addLocatorHandler(page.getByRole('dialog', { name: 'Preview Notice' }), async (dialog) => {
      await dialog.getByRole('button', { name: 'Continue' }).click()
    })
    await page.addLocatorHandler(page.getByRole('button', { name: 'Configure later' }), async (button) => { await button.click() })
    await page.addLocatorHandler(page.getByRole('dialog', { name: 'Get started' }), async (dialog) => {
      await dialog.getByRole('button', { name: 'Close' }).click()
    })
    await page.goto(server.url)
  })

  afterAll(async () => {
    await browser?.close()
    await server?.stop()
  })

  const detail = () => page.locator('[data-plugin-detail="dsh-web-fetch-enhanced"]')
  const profileConfig = () => composedRows(e2e).find(row => row.id === 'web-fetch-enhanced')?.config ?? {}
  const shoot = async (name: string) => { await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true }) }
  /** Save, then wait until the Host accepted it: the drafts clear and Save turns idle again. */
  const saveAndWait = async (scope = detail()) => {
    const save = scope.getByRole('button', { name: 'Save', exact: true })
    await save.click()
    await scope.getByRole('button', { name: 'Save', exact: true }).and(page.locator(':disabled')).waitFor()
  }

  async function openPluginPage() {
    await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Plugins' }).click()
    await page.locator('[data-plugin-package="dsh-web-fetch-enhanced"]').getByRole('button', { name: /^View / }).click()
    await detail().locator('[data-plugin-config]').waitFor()
  }

  it('shows the plugin with its own title and settings', async () => {
    await openPluginPage()
    await detail().getByRole('heading', { name: 'Web Fetch Enhanced' }).waitFor()
    await detail().getByLabel('Allowed ranges (CIDR)').waitFor()
    await shoot('settings-default')
  })

  it('explains a refused rule, applies the fix, and saves it to the Profile', async () => {
    const cidrs = detail().getByLabel('Allowed ranges (CIDR)')
    const save = detail().getByRole('button', { name: 'Save', exact: true })

    await cidrs.fill('198.18.1.1/15')
    await detail().getByText('Write the range\'s network address.').waitFor()
    expect(await save.isDisabled()).toBe(true)
    await shoot('settings-refused-line')

    await detail().getByRole('button', { name: 'Use 198.18.0.0/15' }).click()
    expect(await cidrs.inputValue()).toBe('198.18.0.0/15')
    await saveAndWait()
    await detail().getByText('Customized').waitFor()
    expect(profileConfig().allowCidrs).toEqual(['198.18.0.0/15'])
    await shoot('settings-saved')

    // Reset removes the override instead of writing an empty list.
    await detail().getByRole('button', { name: 'Reset' }).first().click()
    await saveAndWait()
    expect(await detail().getByText('Customized').count()).toBe(0)
    expect(profileConfig()).not.toHaveProperty('allowCidrs')
  })

  it('says so when the official switch routes web_fetch to the DeepSeek Fetch API', async () => {
    const webSearch = page.locator('[data-plugin-item-detail="web-search"]')
    // The crumb back to the list is labelled for screen readers; match its visible text.
    const crumb = (scope: typeof webSearch) => scope.locator('button').filter({ hasText: /^Plugins$/ })
    const toggleOfficialSwitch = async () => {
      await crumb(detail()).click()
      await page.locator('[data-plugin-item="web-search"]').click()
      const before = await webSearch.getByRole('switch').getAttribute('aria-checked')
      await webSearch.getByRole('switch').click()
      await saveAndWait(webSearch)
      await webSearch.locator(`[role="switch"][aria-checked="${String(before !== 'true')}"]`).waitFor()
      await crumb(webSearch).click()
      await page.locator('[data-plugin-package="dsh-web-fetch-enhanced"]').getByRole('button', { name: /^View / }).click()
    }

    await toggleOfficialSwitch()
    await detail().getByText(/web_fetch currently uses the DeepSeek Fetch API/).waitFor()
    await shoot('settings-routing-notice')

    await toggleOfficialSwitch()
    await detail().locator('[data-plugin-config]').waitFor()
    expect(await detail().getByText(/web_fetch currently uses the DeepSeek Fetch API/).count()).toBe(0)
  })

  it('logs no browser errors', () => {
    writeFileSync(join(artifacts, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2))
    expect(consoleErrors).toEqual([])
  })
})