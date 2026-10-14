// Reached through the overlay barrel (the vcpkg pin), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { VCPKG_VERSION } from '../workspace-overlay'
import { checkCppToolchain } from './cpp-toolchain.use-case'
import type { CiProcesses } from './phase.contract'

let root: string

/** Writes an empty file under the workspace. */
function seed (relative: string): void {
  mkdirSync(dirname(join(root, relative)), { recursive: true })
  writeFileSync(join(root, relative), '')
}

/** A runner whose captures answer from a table of command line to status and output. */
function processes (answers: Record<string, { status: number, stdout?: string }>): CiProcesses {
  return {
    run:     () => 0,
    capture: (command, arguments_) => {
      const answer = answers[[command, ...arguments_].join(' ')] ?? { status: 1 }

      return { status: answer.status, stdout: answer.stdout ?? '' }
    },
  }
}

/** Runs the check and returns what it logged. */
function run (answers: Record<string, { status: number, stdout?: string }>, environment: Record<string, string> = {}): string[] {
  const logged: string[] = []

  expect(checkCppToolchain(root, processes(answers), message => { logged.push(message) }, environment)).toBe(0)

  return logged
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-cpp-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkCppToolchain', () => {
  it('does nothing for a workspace with no CMake project', () => {
    expect(run({})).toEqual(['No C++ projects - skipping.'])
  })

  it('is quiet about a runner that has CMake, a compiler and cppcheck', () => {
    seed('apps/hello/CMakeLists.txt')

    const logged = run({
      'cmake --version':    { status: 0, stdout: 'cmake version 4.4.0\n' },
      'g++ --version':      { status: 0 },
      'cppcheck --version': { status: 0 },
    })

    expect(logged.join('\n')).not.toContain('Warning')
    expect(logged).toContain('C++ compiler g++ found.')
  })

  it('warns, and still returns 0, for each missing tool', () => {
    seed('packages/kit/CMakeLists.txt')

    const logged = run({}).join('\n')

    expect(logged).toContain('CMake was not found')
    expect(logged).toContain('no C++ compiler')
    expect(logged).toContain('cppcheck was not found')
  })

  it('names a CMake older than the 3.20 the projects ask for', () => {
    seed('apps/hello/CMakeLists.txt')

    const logged = run({ 'cmake --version': { status: 0, stdout: 'cmake version 3.16.3\n' } }).join('\n')

    expect(logged).toContain('older than 3.20')
  })

  it('asks for VCPKG_ROOT only when a project has a vcpkg.json', () => {
    seed('apps/hello/CMakeLists.txt')
    expect(run({}).join('\n')).not.toContain('VCPKG_ROOT')

    seed('apps/hello/vcpkg.json')

    expect(run({}).join('\n')).toContain(`at ${VCPKG_VERSION}`)
    expect(run({}, { VCPKG_ROOT: root }).join('\n')).toContain(`vcpkg found at ${root}`)
  })
})
