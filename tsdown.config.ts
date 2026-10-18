import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import manifest from './package.json' with { type: 'json' }

/** `import css from './x.css?inline'` yields the stylesheet text; the client injects it once per mount. */
const inlineCss = {
  name: 'inline-css',
  resolveId(source: string, importer: string | undefined) {
    if (source.endsWith('.css?inline') && importer !== undefined) return resolve(dirname(importer), source)
  },
  async load(id: string) {
    if (!id.endsWith('.css?inline')) return
    return `export default ${JSON.stringify(await readFile(id.slice(0, -'?inline'.length), 'utf8'))}`
  },
}

export default defineConfig([
  {
    // Host face: ESM for the DSH Loader; peers and dependencies stay external.
    entry: { index: 'src/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    outDir: 'lib',
  },
  {
    // Browser face: one factory for DSH's module loader. Platform modules
    // (React, Cordis, @deepseek-ai/*) come from the shell's module table.
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    outDir: 'lib',
    clean: false,
    dts: false,
    plugins: [inlineCss],
    deps: {
      neverBundle: (id: string) => id === 'react' || id.startsWith('react/') || id.startsWith('@deepseek-ai/'),
      // The browser has no module table entry for ordinary npm packages.
      alwaysBundle: ['ipaddr.js'],
    },
    outputOptions: {
      entryFileNames: 'client.cjs',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
    },
  },
])
