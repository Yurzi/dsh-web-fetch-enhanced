import { readFileSync } from 'node:fs'
import semver from 'semver'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  engines: { dsh: string }
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const peers = Object.entries(manifest.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

describe('DSH rc.2 compatibility floor', () => {
  it('pins development to the tested release and removes obsolete peers', () => {
    expect(peers.length).toBeGreaterThan(0)
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-settings')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-settings-plugins')
    for (const [name] of peers) expect(manifest.devDependencies[name]).toBe('0.1.7-rc.2')
  })

  it.each([false, true])('enforces floor with includePrerelease=%s', (includePrerelease) => {
    // DSH Host uses includePrerelease:true; package managers may use default semantics.
    for (const range of [manifest.engines.dsh, ...peers.map(([, range]) => range)]) {
      for (const version of ['0.1.5-rc.2', '0.1.6', '0.1.7-alpha.2', '0.1.7-rc.0', '0.1.7-rc.1', '0.2.0']) {
        expect(semver.satisfies(version, range, { includePrerelease }), `${version} vs ${range}`).toBe(false)
      }
      for (const version of ['0.1.7-rc.2', '0.1.7-rc.3', '0.1.7']) {
        expect(semver.satisfies(version, range, { includePrerelease }), `${version} vs ${range}`).toBe(true)
      }
    }
  })
})
