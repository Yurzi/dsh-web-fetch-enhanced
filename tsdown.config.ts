import { readFileSync } from 'node:fs'
import { defineConfig, type UserConfig } from 'tsdown'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { readonly name: string }
const id = manifest.name

const shared: UserConfig = {
  outDir: 'lib',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default defineConfig([
  { ...shared, entry: ['lib/types/index.js'], format: ['esm'], platform: 'node' },
  {
    ...shared,
    entry: { client: 'lib/types/client/index.js' },
    format: ['cjs'],
    platform: 'browser',
    sourcemap: true,
    deps: {
      neverBundle: (specifier: string) => specifier === 'react' || specifier === 'react/jsx-runtime' || specifier.startsWith('@deepseek-ai/'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
