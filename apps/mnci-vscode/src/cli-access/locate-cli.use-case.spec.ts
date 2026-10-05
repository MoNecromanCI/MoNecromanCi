import { join } from 'node:path'
import { locateCli, type LocateProbes } from './locate-cli.use-case'

/** Probes that answer from a fixed set: files that exist, and commands that work. */
function probes (files: string[], working: string[]): LocateProbes {
  return {
    fileExists:   path => files.includes(path),
    commandWorks: command => working.includes(command),
  }
}

describe('locateCli', () => {
  it('uses the setting first, whatever else is installed', () => {
    const location = locateCli({ configured: '/opt/mnci', workspaceRoot: '/ws', platform: 'linux' }, probes(['/ws/node_modules/.bin/mnci'], ['mnci']))

    expect(location).toEqual({ command: '/opt/mnci', prefix: [], source: 'setting' })
  })

  it('ignores a setting that is only whitespace', () => {
    const location = locateCli({ configured: ' '.repeat(3), platform: 'linux' }, probes([], []))

    expect(location.source).toBe('npx')
  })

  it("prefers the workspace's own install, the version it was built with, over a global one", () => {
    const local = join('/ws', 'node_modules', '.bin', 'mnci')

    expect(locateCli({ workspaceRoot: '/ws', platform: 'linux' }, probes([local], ['mnci']))).toEqual({ command: local, prefix: [], source: 'workspace' })
  })

  it('looks for the .cmd shim on Windows', () => {
    const shim = join('C:/ws', 'node_modules', '.bin', 'mnci.cmd')

    expect(locateCli({ workspaceRoot: 'C:/ws', platform: 'win32' }, probes([shim], [])).command).toBe(shim)
  })

  it('falls back to a global install when the workspace has none', () => {
    expect(locateCli({ workspaceRoot: '/ws', platform: 'linux' }, probes([], ['mnci']))).toEqual({ command: 'mnci', prefix: [], source: 'path' })
  })

  it('falls back to npx, which fetches the newest, when nothing is installed', () => {
    expect(locateCli({ platform: 'linux' }, probes([], []))).toEqual({ command: 'npx', prefix: ['--yes', '@mnci/cli'], source: 'npx' })
  })
})
