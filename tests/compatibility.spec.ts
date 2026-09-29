import { readFileSync } from 'node:fs'
import semver from 'semver'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  engines: { dsh: string }
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const peers = Object.entries(manifest.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

describe('DSH 0.2.0-rc.1 compatibility floor', () => {
  it('pins development to the tested release and removes obsolete peers', () => {
    expect(peers.length).toBeGreaterThan(0)
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-settings')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-settings-plugins')
    expect(manifest.engines.dsh).toBe('>=0.2.0-rc.1 <0.3.0-0')
    for (const [name, range] of peers) {
      expect(range).toBe(manifest.engines.dsh)
      expect(manifest.devDependencies[name]).toBe('0.2.0-rc.1')
    }
  })

  it.each([false, true])('enforces floor with includePrerelease=%s', (includePrerelease) => {
    // DSH Host uses includePrerelease:true; package managers may use default semantics.
    // The <0.3.0-0 ceiling also rejects 0.3.0 prereleases in Host checks.
    for (const range of [manifest.engines.dsh, ...peers.map(([, range]) => range)]) {
      for (const version of ['0.1.7-rc.2', '0.1.7', '0.1.99', '0.2.0-alpha.1', '0.2.0-rc.0', '0.3.0-alpha.1', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
        expect(semver.satisfies(version, range, { includePrerelease }), `${version} vs ${range}`).toBe(false)
      }
      for (const version of ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1', '0.2.99']) {
        expect(semver.satisfies(version, range, { includePrerelease }), `${version} vs ${range}`).toBe(true)
      }
    }
  })
})
