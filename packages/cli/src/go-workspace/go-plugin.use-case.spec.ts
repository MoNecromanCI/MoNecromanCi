import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasGoProject, isNxGoPluginRegistered, NX_GO_PLUGIN, registerNxGoPlugin } from './go-plugin.use-case'

let workspaceRoot: string

/** Writes `<directory>/<name>/project.json` with the given raw content. */
function project (directory: string, name: string, content: string): void {
  mkdirSync(join(workspaceRoot, directory, name), { recursive: true })
  writeFileSync(join(workspaceRoot, directory, name, 'project.json'), content)
}

/** Writes the workspace's `nx.json`. */
function nxJson (content: Record<string, unknown>): void {
  writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify(content))
}

/** Reads the workspace's `nx.json` back. */
function readNxJson (): { plugins?: unknown[]; [key: string]: unknown } {
  return JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as ReturnType<typeof readNxJson>
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-go-plugin-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('hasGoProject', () => {
  it.each(['apps', 'libs', 'packages'])('is true for a Go project under %s', (directory) => {
    project(directory, 'thing', JSON.stringify({ tags: ['type:go-app'] }))

    expect(hasGoProject(workspaceRoot)).toBe(true)
  })

  it.each(['type:go-app', 'type:go-function-app', 'type:go-lib', 'type:go-internal-lib'])('recognises the %s tag', (tag) => {
    project('apps', 'thing', JSON.stringify({ tags: [tag] }))

    expect(hasGoProject(workspaceRoot)).toBe(true)
  })

  it('is false when no project is a Go one, however many there are', () => {
    project('apps', 'web', JSON.stringify({ tags: ['type:react-app'] }))
    project('libs', 'utils', JSON.stringify({}))

    expect(hasGoProject(workspaceRoot)).toBe(false)
  })

  it('is false for a root go.mod alone: an adopted repository has one before any Go project', () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module flat\n\ngo 1.22\n')

    expect(hasGoProject(workspaceRoot)).toBe(false)
  })

  it('skips a project file it cannot read, rather than failing the command', () => {
    project('apps', 'broken', '{ not json')
    project('apps', 'tool', JSON.stringify({ tags: ['type:go-app'] }))

    expect(hasGoProject(workspaceRoot)).toBe(true)
  })
})

describe('isNxGoPluginRegistered', () => {
  it('is true for the bare name, which is what the plugin\'s init writes', () => {
    nxJson({ plugins: ['@nx/js/typescript', NX_GO_PLUGIN] })

    expect(isNxGoPluginRegistered(workspaceRoot)).toBe(true)
  })

  it('is true for the name given with options', () => {
    nxJson({ plugins: [{ plugin: NX_GO_PLUGIN, options: { skipGoDependencyCheck: true } }] })

    expect(isNxGoPluginRegistered(workspaceRoot)).toBe(true)
  })

  it('is false when it is installed but not listed, and when there is no plugins key or no nx.json', () => {
    nxJson({ plugins: ['@nx/js/typescript'] })
    expect(isNxGoPluginRegistered(workspaceRoot)).toBe(false)

    nxJson({})
    expect(isNxGoPluginRegistered(workspaceRoot)).toBe(false)

    rmSync(join(workspaceRoot, 'nx.json'))
    expect(isNxGoPluginRegistered(workspaceRoot)).toBe(false)
  })
})

describe('registerNxGoPlugin', () => {
  it('appends the bare name, keeping the plugins and the keys that were there', () => {
    nxJson({ defaultBase: 'main', plugins: ['@nx/js/typescript', { plugin: '@nx/eslint/plugin' }] })

    expect(registerNxGoPlugin(workspaceRoot)).toBe(true)

    expect(readNxJson()).toEqual({
      defaultBase: 'main',
      plugins:     ['@nx/js/typescript', { plugin: '@nx/eslint/plugin' }, NX_GO_PLUGIN],
    })
  })

  it('creates the plugins list when there is none', () => {
    nxJson({ defaultBase: 'main' })

    expect(registerNxGoPlugin(workspaceRoot)).toBe(true)

    expect(readNxJson().plugins).toEqual([NX_GO_PLUGIN])
  })

  it('is idempotent: a second call changes nothing and says so', () => {
    nxJson({ plugins: [] })

    expect(registerNxGoPlugin(workspaceRoot)).toBe(true)
    const once = readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')

    expect(registerNxGoPlugin(workspaceRoot)).toBe(false)
    expect(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')).toBe(once)
  })

  it('leaves an entry that already has options alone', () => {
    nxJson({ plugins: [{ plugin: NX_GO_PLUGIN, options: { skipGoDependencyCheck: true } }] })

    expect(registerNxGoPlugin(workspaceRoot)).toBe(false)
    expect(readNxJson().plugins).toEqual([{ plugin: NX_GO_PLUGIN, options: { skipGoDependencyCheck: true } }])
  })

  it('does nothing, and writes no file, without an nx.json', () => {
    expect(registerNxGoPlugin(workspaceRoot)).toBe(false)
    expect(() => readFileSync(join(workspaceRoot, 'nx.json'))).toThrow()
  })
})
