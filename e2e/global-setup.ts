/**
 * Prepare one isolated DSH world for the whole e2e run:
 *
 * 1. wipe `.e2e/run` and redirect every home, cache, and temp directory into it;
 * 2. install the DSH CLI under test (cached per version);
 * 3. pack the built plugin the way npm publishes it;
 * 4. create the shipped `web` profile and install the tarball with the real
 *    plugin manager — the same `dsh plugin add` a user runs.
 *
 * Test files receive the result through `inject('e2e')`.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { artifacts, dsh, ensureDsh, isolatedEnvironment, packPlugin, run } from './support/environment.ts'

export default function setup(project: TestProject): void {
  rmSync(run, { recursive: true, force: true })
  mkdirSync(artifacts, { recursive: true })
  const install = ensureDsh()
  const e2e = { install, cli: join(install, 'node_modules/.bin/dsh'), env: isolatedEnvironment(), tarball: packPlugin() }
  // The first command against a profile creates it from the shipped template.
  dsh(e2e, ['--profile', 'web', '--dump-config'])
  // `--profile` must precede the arguments forwarded to pnpm. The store lives
  // inside the run, and removing a package later needs the same `--store-dir`.
  dsh(e2e, ['plugin', '--profile', 'web', 'add', e2e.tarball, '--store-dir', join(run, 'pnpm-store'), '--ignore-scripts'])
  project.provide('e2e', e2e)
}
