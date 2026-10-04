// The nx-workspace barrel transitively loads @inquirer/prompts (ESM-only, unparseable by
// jest as CJS). Stub it so the real barrel — and its real runCapture, which these tests need
// to read the git origin — loads.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasGoProject, isNxGoPluginRegistered, modulePrefixFromRemoteUrl, NX_GO_PLUGIN, registerNxGoPlugin } from './go-plugin.use-case'

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

describe('modulePrefixFromRemoteUrl', () => {
  it.each([
    ['https://github.com/MoNecromanCI/MoNecromanCi.git', 'github.com/MoNecromanCI/MoNecromanCi'],
    ['https://github.com/MoNecromanCI/MoNecromanCi', 'github.com/MoNecromanCI/MoNecromanCi'],
    ['git@github.com:MoNecromanCI/MoNecromanCi.git', 'github.com/MoNecromanCI/MoNecromanCi'],
    ['ssh://git@github.com/org/repo.git', 'github.com/org/repo'],
    ['https://user:token@dev.azure.com/acme/proj/_git/widget', 'dev.azure.com/acme/proj/_git/widget'],
  ])('maps %s to its host/path module prefix', (url, expected) => {
    expect(modulePrefixFromRemoteUrl(url)).toBe(expected)
  })

  it.each(['', ' '.repeat(3), 'not-a-url', String.raw`C:\local\path`])('is undefined for a non-URL (%p)', (url) => {
    expect(modulePrefixFromRemoteUrl(url)).toBeUndefined()
  })
})

const hasGit = spawnSync('git', ['--version']).status === 0
const describeWithGit = hasGit ? describe : describe.skip
if (!hasGit) {
  console.warn('SKIPPED: registerNxGoPlugin origin tests need git on PATH')
}

describeWithGit('registerNxGoPlugin with a git origin', () => {
  it('registers the plugin with a modulePrefix derived from origin', () => {
    execFileSync('git', ['init', '-q'], { cwd: workspaceRoot })
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widget.git'], { cwd: workspaceRoot })
    nxJson({ plugins: [] })

    expect(registerNxGoPlugin(workspaceRoot)).toBe(true)
    expect(readNxJson().plugins).toEqual([{ plugin: NX_GO_PLUGIN, options: { modulePrefix: 'github.com/acme/widget' } }])
  })

  it('upgrades the bare name init writes to carry the modulePrefix', () => {
    execFileSync('git', ['init', '-q'], { cwd: workspaceRoot })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/widget.git'], { cwd: workspaceRoot })
    nxJson({ plugins: [NX_GO_PLUGIN] })

    expect(registerNxGoPlugin(workspaceRoot)).toBe(true)
    expect(readNxJson().plugins).toEqual([{ plugin: NX_GO_PLUGIN, options: { modulePrefix: 'github.com/acme/widget' } }])
  })
})
