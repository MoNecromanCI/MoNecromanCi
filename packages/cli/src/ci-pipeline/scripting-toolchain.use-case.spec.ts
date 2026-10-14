// Reached through the overlay barrel (pinned tool versions), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PHP_VERSION, RUBY_VERSION } from '../workspace-overlay'
import type { CiProcesses } from './phase.contract'
import { checkScriptingToolchains } from './scripting-toolchain.use-case'

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
function run (answers: Record<string, { status: number, stdout?: string }>): string[] {
  const logged: string[] = []

  expect(checkScriptingToolchains(root, processes(answers), message => { logged.push(message) })).toBe(0)

  return logged
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-scripting-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkScriptingToolchains', () => {
  it('does nothing for a workspace with no PHP or Ruby project', () => {
    expect(run({})).toEqual(['No PHP or Ruby projects - skipping.'])
  })

  it('accepts PHP and Composer at the pinned minor', () => {
    seed('apps/web/composer.json')

    expect(run({
      'php --version':      { status: 0, stdout: `PHP ${PHP_VERSION}.25 (cli)` },
      'composer --version': { status: 0, stdout: 'Composer version 2.10.3' },
    })).toEqual([`PHP ${PHP_VERSION} found.`])
  })

  it('names a PHP of another minor, and a missing Composer', () => {
    seed('libs/kit/composer.json')

    expect(run({ 'php --version': { status: 0, stdout: 'PHP 7.4.1 (cli)' } })).toEqual([
      `Warning: this runner's PHP 7.4 is not ${PHP_VERSION}, which the projects were verified with.`,
      'Warning: Composer was not found on PATH.',
    ])
  })

  it('names a missing Ruby and Bundler, and checks only the languages the workspace has', () => {
    seed('apps/api/Gemfile')

    expect(run({})).toEqual([
      `Warning: Ruby was not found on PATH; mnci's projects were verified with Ruby ${RUBY_VERSION}.`,
      'Warning: Bundler was not found on PATH.',
    ])
  })
})
