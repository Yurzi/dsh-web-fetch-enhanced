import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface Manifest {
  readonly name: string
  readonly files: readonly string[]
  readonly exports: Record<string, unknown>
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest
const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const sourcePatchText = readFileSync(new URL('../cordis.source.patch.yml', import.meta.url), 'utf8')

describe('installable DSH profile bundle', () => {
  it('publishes built and source-development composition layers', () => {
    expect(manifest.name).toBe('dsh-web-fetch-enhanced')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.exports).toHaveProperty('./cordis.patch.yml', './cordis.patch.yml')
    expect(sourcePatchText).toContain("name: './src/index.ts'")
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
