/**
 * Boot the real host plane of the isolated `web` profile inside the test
 * process, through the same steps the `dsh` CLI takes: load the profile,
 * resolve its packages, read its bundle and user patch layers, then boot the
 * composed entry list. No service is faked and no provider is registered by
 * the test; whatever `ctx.web` does here is what DSH does for a real user.
 *
 * These are public exports of the installed DSH packages, but they are the
 * CLI's building blocks rather than a documented embedding API, so this file
 * is the one place to adjust when a DSH release changes them.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRuntime } from '@deepseek-ai/dsh-web'
import { type E2EContext, run } from './environment.ts'

/** A booted host plane. */
export interface Host {
  readonly web: WebRuntime
  /** Run one prompt assembly and return the runtime context the model would receive. */
  modelContext(): Promise<{ name: string; text: string }[]>
  dispose(): Promise<void>
}

/** The pieces of `@deepseek-ai/dsh-app-boot` the CLI uses to start a profile. */
interface AppBoot {
  loadProfile(binName: string, name: string, installAnchor: string): { dir: string; patchPath: string; layers: { packageName: string }[] }
  createRuntimeResolution(options: { installAnchor: string; profile: unknown }): Promise<unknown>
  loadOverlayPatches(binName: string, file: string): unknown[]
  readProfilePatches(binName: string, context: object, profile: unknown): unknown[]
  boot(binName: string, configPath: string, patches: unknown[], prepare: (ctx: Context) => Promise<void>): Promise<Context>
  PluginPackages: object
}

const BIN = 'wfe-e2e'

/**
 * @param e2e - the run's install and environment; `process.env` must already be the isolated one.
 * @param overlays - extra patch files, applied after the profile's own layers like `dsh --patch`.
 * @returns the booted host plane.
 */
export async function bootHost(e2e: E2EContext, overlays: readonly string[]): Promise<Host> {
  const anchor = join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json')
  const require = createRequire(anchor)
  const app = require('@deepseek-ai/dsh-app-boot') as AppBoot
  const { provideCmdline } = require('@deepseek-ai/dsh-cmdline') as { provideCmdline: (ctx: Context, options: object) => void }
  const { createLaunchEnvironmentSnapshot } = require('@deepseek-ai/dsh-launch-environment') as {
    createLaunchEnvironmentSnapshot: (layers: { source: string; values: NodeJS.ProcessEnv }[]) => unknown
  }

  const profile = app.loadProfile(BIN, 'web', anchor)
  const resolution = await app.createRuntimeResolution({ installAnchor: anchor, profile })
  // What the launcher knows about the profile it starts; plugins read it as `ctx.profileContext`.
  const context = {
    name: 'web',
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: anchor,
    startedBundles: profile.layers.map(layer => layer.packageName),
    cwd: run,
    home: e2e.env.DSH_HOME,
    overlays: [join(import.meta.dirname, '../fixtures/host-plane.yml'), ...overlays]
      .flatMap(file => app.loadOverlayPatches(BIN, file)),
    telemetryDisabledEnv: '1',
  }
  const ctx = await app.boot(BIN, join(profile.dir, 'cordis.yml'), app.readProfilePatches(BIN, context, profile), async (root) => {
    root.provide('profileContext', context)
    root.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]))
    await root.plugin(app.PluginPackages as Parameters<Context['plugin']>[0], { resolution })
    provideCmdline(root, { args: [], exit: (code: number) => { throw new Error(`unexpected exit ${code}`) }, ready: { onReady: () => () => {} } })
  })

  const web = ctx.get('web')
  if (web === undefined) throw new Error('the composed profile did not provide ctx.web')
  return {
    web,
    async modelContext() {
      const prompt = ctx.get('systemPrompt') as { assemble(): Promise<{ contexts: { name: string; text: string }[] }> }
      return (await prompt.assemble()).contexts
    },
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}
