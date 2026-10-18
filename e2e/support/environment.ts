/**
 * The isolated world an end-to-end run happens in.
 *
 * Everything DSH, npm, or pnpm writes during a run — the DSH home with its
 * profiles, the OS home, XDG directories, caches, the pnpm store, temp files —
 * lives under `.e2e/run`, which is wiped at the start of every run. A run
 * therefore never reads or changes the developer's own DSH home, profiles,
 * credentials, or a GUI they already have open.
 *
 * The DSH CLI itself is installed once per version under `.e2e/dsh-<version>`
 * (about 600 packages, a few minutes the first time) and reused afterwards.
 * Point `DSH_E2E_INSTALL` at an existing install to skip that step.
 */
import { execFileSync } from 'node:child_process'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import manifest from '../../package.json' with { type: 'json' }

/** Repository root. */
export const repo = resolve(import.meta.dirname, '../..')

/** Scratch space for runs, ignored by git. */
export const workspace = join(repo, '.e2e')

/** This run's isolated world; recreated by the global setup. */
export const run = join(workspace, 'run')

/** Screenshots and logs worth keeping after a run. */
export const artifacts = join(workspace, 'artifacts')

/** The DSH release under test: the one the unit tests compile against. */
export const DSH_VERSION = manifest.devDependencies['@deepseek-ai/dsh-web']

/** What the global setup hands every e2e test file. */
export interface E2EContext {
  /** Directory whose `node_modules` holds `@deepseek-ai/dsh` and its packages. */
  readonly install: string
  /** The `dsh` executable. */
  readonly cli: string
  /** Environment for every DSH process and for the in-process host boot. */
  readonly env: Record<string, string>
  /** The packed plugin tarball installed into the `web` profile. */
  readonly tarball: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    e2e: E2EContext
  }
}

/**
 * Variables a developer may have exported that would hide a composition
 * mistake (a pinned provider) or change behavior (a real DeepSeek key).
 * Proxy variables are kept: pnpm needs them to reach the registry.
 */
const CLEARED = ['DSH_WEB_SEARCH_PROVIDER', 'DSH_WEB_FETCH_PROVIDER', 'DEEPSEEK_API_KEY', 'DEEPSEEK_TOKEN']

/**
 * Build the run's environment and create its directories.
 * @returns the current environment with every home, cache, and temp directory redirected into `.e2e/run`.
 */
export function isolatedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !CLEARED.includes(name)) env[name] = value
  }
  const dirs = {
    HOME: 'os-home', // npm, pnpm, and git read ~/.npmrc, ~/.gitconfig, ...
    DSH_HOME: 'home', // profiles, settings, credentials, sessions
    XDG_CACHE_HOME: 'cache',
    XDG_CONFIG_HOME: 'config',
    XDG_DATA_HOME: 'data',
    TMPDIR: 'tmp',
    DSH_AGENTS_HOME: 'agents', // user-level AGENTS.md and agent presets
    DSH_BUNDLED_SKILL_DIR: 'skills',
    COREPACK_HOME: 'corepack',
    npm_config_cache: 'npm-cache',
  }
  for (const [name, dir] of Object.entries(dirs)) {
    env[name] = join(run, dir)
    mkdirSync(env[name], { recursive: true })
  }
  env.DSH_TELEMETRY_DISABLED = '1'
  return env
}

/**
 * Make sure the DSH CLI under test is installed.
 * @returns the install directory.
 */
export function ensureDsh(): string {
  const install = process.env.DSH_E2E_INSTALL ?? join(workspace, `dsh-${DSH_VERSION}`)
  const pkg = join(install, 'node_modules/@deepseek-ai/dsh/package.json')
  if (!existsSync(pkg)) {
    mkdirSync(install, { recursive: true })
    execFileSync('npm', ['install', '--prefix', install, '--no-audit', '--no-fund', `@deepseek-ai/dsh@${DSH_VERSION}`], { stdio: 'inherit' })
  }
  const { version } = JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }
  if (version !== DSH_VERSION) throw new Error(`${install} has DSH ${version}; the e2e suite targets ${DSH_VERSION}`)
  return install
}

/**
 * Pack the built plugin exactly as npm would publish it.
 * @returns the tarball path.
 */
export function packPlugin(): string {
  // prepack would rerun the whole check; `pnpm run test:e2e` builds first.
  execFileSync('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', run], { cwd: repo, stdio: 'ignore' })
  return join(run, `${manifest.name}-${manifest.version}.tgz`)
}

/**
 * Run the DSH CLI inside the isolated world.
 * @param e2e - the run's install and environment.
 * @param args - CLI arguments.
 * @returns standard output.
 */
export function dsh(e2e: Pick<E2EContext, 'cli' | 'env'>, args: readonly string[]): string {
  return execFileSync(e2e.cli, args, { cwd: run, env: e2e.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** One row of a composed entry list. */
export interface ComposedRow {
  readonly id: string
  readonly name?: string
  readonly disabled?: boolean
  readonly config?: Record<string, unknown>
}

/**
 * The `web` profile as DSH composes it: base bundle, plugin bundles, then the
 * user layer the settings page writes.
 * @param e2e - the run's install and environment.
 * @returns the top-level rows of `dsh --profile web --dump-config`.
 */
export function composedRows(e2e: Pick<E2EContext, 'cli' | 'env'>): ComposedRow[] {
  // The dump keeps `!!js` expressions; read it with the dialect the Loader uses.
  return load(dsh(e2e, ['--profile', 'web', '--dump-config']), { schema: entryListSchema }) as ComposedRow[]
}

/**
 * Make this test process look like the isolated world, for code that reads
 * `process.env` directly (the in-process host boot).
 * @param env - the run's environment.
 */
export function enterIsolatedEnvironment(env: Record<string, string>): void {
  for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name]
  Object.assign(process.env, env)
}
