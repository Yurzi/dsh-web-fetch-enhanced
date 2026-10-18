import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { load } from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import manifest from '../package.json' with { type: 'json' }

/** The web rows of DSH 0.2.1-rc.2's base bundle (packages/bundle/base/cordis.patch.yml). */
const baseRows: EntryOptions[] = [
  { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
  { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-fetch-http', name: '@deepseek-ai/dsh-web-fetch-http' },
]

describe('profile bundle', () => {
  it('swaps the native fetch provider without touching the shared web row', () => {
    const patch = load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as PatchOptions[]
    const warn = vi.fn()
    const rows = applyEntryPatches(baseRows, patch, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(rows.find(row => row.id === 'web')).toEqual(baseRows[0])
    expect(rows.find(row => row.id === 'web-fetch-http')).toMatchObject({ disabled: true })
    expect(rows.find(row => row.id === 'web-fetch-enhanced')).toEqual({ id: 'web-fetch-enhanced', name: manifest.name })
    // The provider takes the id the untouched web row already selects.
    expect(Config({}).providerId).toBe(baseRows[0]!.config.fetchProvider)
  })

  const built = new URL('../lib/client.cjs', import.meta.url)

  it.skipIf(!existsSync(built))('registers the built client through the DSH module loader', async () => {
    let registration: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> } | undefined
    runInNewContext(readFileSync(built, 'utf8'), { window: { __ModuleLoader__: { load: (value: typeof registration) => { registration = value } } } })
    expect(registration?.id).toBe(manifest.name)
    const shared: Record<string, unknown> = {
      'react': await import('react'),
      'react/jsx-runtime': await import('react/jsx-runtime'),
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    const exports = registration!.factory((id) => {
      if (!(id in shared)) throw new Error(`client requested a module outside the shell's table: ${id}`)
      return shared[id]
    })
    expect(exports).toMatchObject({ name: 'web-fetch-enhanced-client', inject: ['slots', 'locale', 'configForms'] })
  })
})
