// Reached through the overlay barrel, which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPack } from './pack.use-case'
import type { CiProcesses } from './phase.contract'

let workspaceRoot: string

interface Harness {
  /** Every command started, in order, as one line. */
  commands:  string[]
  /** Every line logged. */
  logged:    string[]
  /** The recording runner, to hand to the phase. */
  processes: CiProcesses
}

/**
 * Builds a process runner that records what runs and gives each command a status.
 *
 * @param statuses - The exit status of a command, keyed by its full line; anything else exits 0.
 */
function harness (statuses: Record<string, number> = {}): Harness {
  const commands: string[] = []
  const logged: string[] = []
  const processes: CiProcesses = {
    run: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      commands.push(line)

      return statuses[line] ?? 0
    },
    capture: () => ({ status: 1, stdout: '' }),
  }

  return { commands, logged, processes }
}

/** Runs the phase with the recording runner, and returns what it did. */
function pack (setup: Harness): number {
  return runPack(workspaceRoot, { processes: setup.processes, log: (message) => { setup.logged.push(message) } })
}

/** Writes a file under the workspace, making its directory first. */
function seed (relative: string, content = '{}'): void {
  const path = join(workspaceRoot, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-pack-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('the pack phase', () => {
  it('skips cleanly, and starts nothing, when there is no app to pack', () => {
    const setup = harness()

    expect(pack(setup)).toBe(0)
    expect(setup.commands).toEqual([])
    expect(setup.logged).toContain('No apps to pack - skipping.')
  })

  it('creates dist/drop even when it skips, because the upload step points at it', () => {
    pack(harness())

    expect(existsSync(join(workspaceRoot, 'dist', 'drop'))).toBe(true)
  })

  it('packs every app with `nx run-many -t package` when a project.json app exists', () => {
    seed('apps/api/project.json', JSON.stringify({ name: 'api' }))
    const setup = harness()

    expect(pack(setup)).toBe(0)
    expect(setup.commands).toEqual(['npx nx run-many -t package'])
  })

  it('recognises an app declared by an inline nx block in its package.json', () => {
    seed('apps/web/package.json', JSON.stringify({ name: '@demo/web', nx: {} }))
    const setup = harness()

    expect(pack(setup)).toBe(0)
    expect(setup.commands).toEqual(['npx nx run-many -t package'])
  })

  it('recognises a C# app declared by a .csproj', () => {
    seed('apps/service/service.csproj', '<Project />')
    const setup = harness()

    expect(pack(setup)).toBe(0)
    expect(setup.commands).toEqual(['npx nx run-many -t package'])
  })

  it('does not take a package.json without an nx block for an app', () => {
    seed('apps/lib/package.json', JSON.stringify({ name: '@demo/lib' }))
    const setup = harness()

    expect(pack(setup)).toBe(0)
    expect(setup.commands).toEqual([])
    expect(setup.logged).toContain('No apps to pack - skipping.')
  })

  it('treats a malformed package.json as not an app, rather than throwing', () => {
    seed('apps/broken/package.json', '{ not json')
    const setup = harness()

    expect(pack(setup)).toBe(0)
    expect(setup.commands).toEqual([])
  })

  it('returns the package run\'s status when it fails', () => {
    seed('apps/api/project.json', JSON.stringify({ name: 'api' }))
    const setup = harness({ 'npx nx run-many -t package': 2 })

    expect(pack(setup)).toBe(2)
  })
})
