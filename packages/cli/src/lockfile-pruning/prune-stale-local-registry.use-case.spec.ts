// The use case reaches the process runner through a barrel that loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneStaleLocalRegistry } from './prune-stale-local-registry.use-case'
import { hasStaleLocalRegistry } from './stale-local-registry.validator'

let workspaceRoot: string

/** Writes a JSON file under the workspace. */
function write (path: string, value: unknown): void {
  mkdirSync(join(workspaceRoot, path, '..'), { recursive: true })
  writeFileSync(join(workspaceRoot, path), JSON.stringify(value, undefined, 2))
}

/** A lockfile that carries verdaccio, as a workspace generated with a publishable library does. */
function lockWithVerdaccio (): Record<string, unknown> {
  return {
    name:            'demo',
    lockfileVersion: 3,
    packages:        {
      '':                       { name: 'demo', devDependencies: { 'verdaccio': '^6.0.0', '@nx/js': '23.0.0' } },
      'packages/core':          { name: '@demo/core' },
      'node_modules/@nx/js':    { version: '23.0.0', peerDependencies: { verdaccio: '^6.0.5' } },
      'node_modules/verdaccio': { version: '6.10.5', dev: true, optional: true },
      'node_modules/braces':    { version: '3.0.3', dev: true },
    },
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-lock-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true })
})

describe('hasStaleLocalRegistry', () => {
  it('is true when the lockfile has verdaccio and no manifest declares it', () => {
    write('package.json', { name: 'demo', devDependencies: { '@nx/js': '23.0.0' } })
    write('packages/core/package.json', { name: '@demo/core' })
    write('package-lock.json', lockWithVerdaccio())

    expect(hasStaleLocalRegistry(workspaceRoot)).toBe(true)
  })

  it('is false when the root manifest declares it, on purpose', () => {
    write('package.json', { name: 'demo', devDependencies: { verdaccio: '^6.0.0' } })
    write('packages/core/package.json', { name: '@demo/core' })
    write('package-lock.json', lockWithVerdaccio())

    expect(hasStaleLocalRegistry(workspaceRoot)).toBe(false)
  })

  it('is false when a workspace member declares it', () => {
    write('package.json', { name: 'demo' })
    write('packages/core/package.json', { name: '@demo/core', devDependencies: { verdaccio: '^6.0.0' } })
    write('package-lock.json', lockWithVerdaccio())

    expect(hasStaleLocalRegistry(workspaceRoot)).toBe(false)
  })

  it('is false without the entry, without a lockfile, and for a lockfile that is not JSON', () => {
    write('package.json', { name: 'demo' })

    expect(hasStaleLocalRegistry(workspaceRoot)).toBe(false)

    write('package-lock.json', { packages: { '': {} } })

    expect(hasStaleLocalRegistry(workspaceRoot)).toBe(false)

    writeFileSync(join(workspaceRoot, 'package-lock.json'), '{ not json')

    expect(hasStaleLocalRegistry(workspaceRoot)).toBe(false)
  })
})

describe('pruneStaleLocalRegistry', () => {
  it('does nothing, and runs nothing, when the lockfile is clean', () => {
    write('package.json', { name: 'demo' })
    write('package-lock.json', { packages: { '': {} } })
    const calls: string[] = []

    const result = pruneStaleLocalRegistry(workspaceRoot, command => {
      calls.push(command)

      return 0
    })

    expect(result).toEqual({ stale: false, status: 0 })
    expect(calls).toEqual([])
  })

  it('drops the entry and the root claim, then re-resolves the lockfile only', () => {
    write('package.json', { name: 'demo', devDependencies: { '@nx/js': '23.0.0' } })
    write('package-lock.json', lockWithVerdaccio())
    const calls: string[][] = []

    const result = pruneStaleLocalRegistry(workspaceRoot, (command, arguments_, cwd) => {
      calls.push([command, ...arguments_, cwd])

      return 0
    })

    const lock = JSON.parse(readFileSync(join(workspaceRoot, 'package-lock.json'), 'utf8')) as { packages: Record<string, { devDependencies?: Record<string, string> }> }

    expect(result).toEqual({ stale: true, status: 0 })
    expect(lock.packages['node_modules/verdaccio']).toBeUndefined()
    expect(lock.packages[''].devDependencies).toEqual({ '@nx/js': '23.0.0' })
    expect(lock.packages['node_modules/braces']).toBeDefined()
    expect(calls).toEqual([['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', workspaceRoot]])
  })

  it('reports a failing re-resolve instead of hiding it', () => {
    write('package.json', { name: 'demo' })
    write('package-lock.json', lockWithVerdaccio())

    expect(pruneStaleLocalRegistry(workspaceRoot, () => 1)).toEqual({ stale: true, status: 1 })
  })

  it('is stable: a second run finds nothing to do', () => {
    write('package.json', { name: 'demo' })
    write('package-lock.json', lockWithVerdaccio())
    pruneStaleLocalRegistry(workspaceRoot, () => 0)

    expect(pruneStaleLocalRegistry(workspaceRoot, () => 0).stale).toBe(false)
  })
})
