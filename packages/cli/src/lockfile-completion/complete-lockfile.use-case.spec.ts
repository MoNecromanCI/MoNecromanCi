// Reached through the overlay barrel (the npm pin), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NPM_VERSION } from '../workspace-overlay'
import { completeLockfile, type CompleteLockfileDependencies } from './complete-lockfile.use-case'

let root: string
let warnings: string[]
let details: string[]

/** Dependencies whose npm answers with a status and may rewrite the lockfile as a side effect. */
function dependencies (status: number, rewrite?: (lockfile: string) => void): CompleteLockfileDependencies & { commands: string[] } {
  const commands: string[] = []

  return {
    commands,
    capture: (command, arguments_) => {
      commands.push([command, ...arguments_].join(' '))
      if (status === 0 && rewrite !== undefined) {
        rewrite(join(root, 'package-lock.json'))
      }

      return { status, stdout: '' }
    },
    log: { detail: (message) => { details.push(message) }, warn: (message) => { warnings.push(message) } },
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-lockfile-'))
  warnings = []
  details = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('completeLockfile', () => {
  it('runs the pinned npm in package-lock-only mode, so no version can move and nothing is installed', () => {
    writeFileSync(join(root, 'package-lock.json'), '{"packages":{}}\n')
    const deps = dependencies(0)

    completeLockfile(root, deps)

    expect(deps.commands).toEqual([`npx --yes npm@${NPM_VERSION} install --package-lock-only --ignore-scripts --no-audit --no-fund`])
  })

  it('reports a change when npm added entries, and says why', () => {
    writeFileSync(join(root, 'package-lock.json'), '{"packages":{}}\n')

    const changed = completeLockfile(root, dependencies(0, lockfile => { writeFileSync(lockfile, '{"packages":{"node_modules/@emnapi/core":{}}}\n') }))

    expect(changed).toBe(true)
    expect(details.join(' ')).toContain(`completed by npm ${NPM_VERSION}`)
  })

  it('is silent and reports no change when the lockfile was already complete', () => {
    writeFileSync(join(root, 'package-lock.json'), '{"packages":{}}\n')

    expect(completeLockfile(root, dependencies(0))).toBe(false)
    expect(details).toEqual([])
    expect(warnings).toEqual([])
  })

  it('only warns when npm fails, naming the command to run by hand', () => {
    writeFileSync(join(root, 'package-lock.json'), '{"packages":{}}\n')

    expect(completeLockfile(root, dependencies(1))).toBe(false)
    expect(warnings.join(' ')).toContain(`npx npm@${NPM_VERSION} install --package-lock-only`)
  })

  it('does nothing for a workspace with no package-lock.json', () => {
    const deps = dependencies(0)

    expect(completeLockfile(root, deps)).toBe(false)
    expect(deps.commands).toEqual([])
  })
})
