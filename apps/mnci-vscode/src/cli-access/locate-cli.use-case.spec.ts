import { join } from 'node:path'
import { locateCli, type LocateProbes } from './locate-cli.use-case'

/**
 * Probes that answer from a fixed set: files that exist, and the version each working command prints.
 * A command given as a plain name prints the current version.
 */
function probes (files: string[], working: (string | [string, string])[]): LocateProbes {
  const versions = new Map(working.map(entry => (typeof entry === 'string' ? [entry, '4.40.4'] : entry)))

  return {
    fileExists:    path => files.includes(path),
    commandOutput: command => versions.get(command),
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

    expect(locateCli({ workspaceRoot: '/ws', platform: 'linux' }, probes([local], [local, 'mnci']))).toEqual({ command: local, prefix: [], source: 'workspace' })
  })

  it('looks for the .cmd shim on Windows', () => {
    const shim = join('C:/ws', 'node_modules', '.bin', 'mnci.cmd')

    expect(locateCli({ workspaceRoot: 'C:/ws', platform: 'win32' }, probes([shim], [shim])).command).toBe(shim)
  })

  it('falls back to a global install when the workspace has none', () => {
    expect(locateCli({ workspaceRoot: '/ws', platform: 'linux' }, probes([], ['mnci']))).toEqual({ command: 'mnci', prefix: [], source: 'path' })
  })

  it('skips a workspace install older than the JSON commands and uses a newer global one', () => {
    const local = join('/ws', 'node_modules', '.bin', 'mnci')

    expect(locateCli({ workspaceRoot: '/ws', platform: 'linux' }, probes([local], [[local, '4.30.0'], 'mnci']))).toEqual({ command: 'mnci', prefix: [], source: 'path' })
  })

  it('falls back to npx when every install found is too old (4.30.0 answers --json with "unknown option")', () => {
    const local = join('/ws', 'node_modules', '.bin', 'mnci')

    expect(locateCli({ workspaceRoot: '/ws', platform: 'linux' }, probes([local], [[local, '4.30.0'], ['mnci', '4.31.0']])).source).toBe('npx')
  })

  it('treats a workspace install that does not start as absent', () => {
    const local = join('/ws', 'node_modules', '.bin', 'mnci')

    expect(locateCli({ workspaceRoot: '/ws', platform: 'linux' }, probes([local], ['mnci'])).source).toBe('path')
  })

  it('keeps the setting even when that CLI is old: it is the user\'s own choice', () => {
    expect(locateCli({ configured: '/opt/mnci', platform: 'linux' }, probes([], [['/opt/mnci', '4.30.0']])).source).toBe('setting')
  })

  it('falls back to npx, which fetches the newest, when nothing is installed', () => {
    expect(locateCli({ platform: 'linux' }, probes([], []))).toEqual({ command: 'npx', prefix: ['--yes', '@mnci/cli'], source: 'npx' })
  })
})
