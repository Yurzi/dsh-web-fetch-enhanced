import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface Manifest {
  readonly name: string
  readonly files: readonly string[]
  readonly exports: Record<string, unknown>
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string }
    readonly client?: { readonly platform?: string; readonly inject?: readonly string[] }
  }
}

interface ClientBundleRegistration {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest
const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const sourcePatchText = readFileSync(new URL('../cordis.source.patch.yml', import.meta.url), 'utf8')

function readClientBundle(): string | undefined {
  try {
    return readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  } catch {
    return undefined
  }
}

describe('installable DSH profile bundle', () => {
  it('publishes built and source-development composition layers', () => {
    expect(manifest.name).toBe('dsh-web-fetch-enhanced')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.exports).toHaveProperty('./cordis.patch.yml', './cordis.patch.yml')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.files).toContain('lib/client.js')
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-settings-plugins')
    expect(sourcePatchText).toContain("name: './src/index.ts'")
  })

  const clientBundle = readClientBundle()

  it.skipIf(clientBundle === undefined)('registers the built client through the DSH module loader', async () => {
    let registration: ClientBundleRegistration | undefined
    runInNewContext(clientBundle!, {
      window: {
        __ModuleLoader__: {
          load: (value: ClientBundleRegistration) => { registration = value },
        },
      },
    })

    expect(registration).toBeDefined()
    const registered = registration!
    expect(registered.id).toBe(manifest.name)

    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
    ])
    const requested: string[] = []
    const exports = registered.factory((specifier) => {
      requested.push(specifier)
      if (!modules.has(specifier)) throw new Error(`unexpected client module request: ${specifier}`)
      return modules.get(specifier)
    })

    expect(new Set(requested)).toEqual(new Set(['react', 'react/jsx-runtime']))
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['slots', 'locale', 'settingsScope'])
  })

  it('selects the enhanced provider and inserts exactly one Host row', () => {
    expect(load(patchText)).toEqual([
      {
        id: 'web',
        config: {
          searchProvider: 'deepseek-official',
          fetchProvider: 'http-enhanced',
        },
      },
      {
        insert: [
          { id: 'web-fetch-enhanced', name: 'dsh-web-fetch-enhanced' },
        ],
      },
    ])
  })
})
