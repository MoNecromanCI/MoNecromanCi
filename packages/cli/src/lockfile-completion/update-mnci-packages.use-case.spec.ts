// Reached through the overlay barrel (the npm pin), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NPM_VERSION } from '../workspace-overlay'
import type { CompleteLockfileDependencies } from './complete-lockfile.use-case'
import { updateMnciPackagesInLockfile } from './update-mnci-packages.use-case'

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

/** Writes the manifest and a lockfile. */
function seed (devDependencies: Record<string, string>, lockfile = true): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ws', devDependencies }))
  if (lockfile) {
    writeFileSync(join(root, 'package-lock.json'), '{"packages":{"node_modules/@mnci/cli":{"version":"4.44.0"}}}\n')
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-update-'))
  warnings = []
  details = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('updateMnciPackagesInLockfile', () => {
  it('asks the pinned npm to update only the mnci packages the manifest declares, in the lockfile alone', () => {
    seed({ '@mnci/cli': '>=4.0.0 <5.0.0', '@mnci/eslint-config': '>=1.0.0', 'zod': '^4.0.0' })
    const deps = dependencies(0)

    updateMnciPackagesInLockfile(root, deps)

    expect(deps.commands).toEqual([
      `npx --yes npm@${NPM_VERSION} update @mnci/cli @mnci/eslint-config --package-lock-only --ignore-scripts --no-audit --no-fund`,
    ])
  })

  it('reports the move when the locked version changed', () => {
    seed({ '@mnci/cli': '>=4.0.0 <5.0.0' })

    const changed = updateMnciPackagesInLockfile(root, dependencies(0, lockfile => {
      writeFileSync(lockfile, '{"packages":{"node_modules/@mnci/cli":{"version":"4.110.2"}}}\n')
    }))

    expect(changed).toBe(true)
    expect(details.join(' ')).toContain('@mnci/cli')
  })

  it('does nothing without a lockfile, or when no mnci package is declared', () => {
    seed({ '@mnci/cli': '>=4.0.0 <5.0.0' }, false)
    const withoutLockfile = dependencies(0)
    seed({ zod: '^4.0.0' })
    const withoutPackages = dependencies(0)

    expect(updateMnciPackagesInLockfile(root, withoutPackages)).toBe(false)
    rmSync(join(root, 'package-lock.json'))
    seed({ '@mnci/cli': '>=4.0.0 <5.0.0' }, false)
    expect(updateMnciPackagesInLockfile(root, withoutLockfile)).toBe(false)
    expect(withoutLockfile.commands).toEqual([])
    expect(withoutPackages.commands).toEqual([])
  })

  it('warns with the command to run by hand when npm fails, and changes nothing', () => {
    seed({ '@mnci/cli': '>=4.0.0 <5.0.0' })

    expect(updateMnciPackagesInLockfile(root, dependencies(1))).toBe(false)
    expect(warnings.join(' ')).toContain(`npx npm@${NPM_VERSION} update @mnci/cli --package-lock-only`)
  })
})
