// Mocked because this spec reaches sibling slices through their barrels, which transitively load
// @inquirer/prompts: ESM-only, and unparseable by jest as CJS. Nothing here exercises a prompt.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UpgradeOptions } from '../workspace-upgrade'
import { adoptOverlay, type OverlayDependencies } from './adopt-overlay.use-case'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-overlay-'))
  writeFileSync(join(root, 'nx.json'), '{}')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { jest: '^30.0.0' } }))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Dependencies on a clean tree whose upgrade records what it was given. */
function fakes (porcelain = ''): { dependencies: OverlayDependencies, received: UpgradeOptions[] } {
  const received: UpgradeOptions[] = []

  return {
    received,
    dependencies: {
      upgrade: (_root, options) => { received.push(options) },
      capture: (command, arguments_) => ({ status: 0, stdout: arguments_[0] === 'status' ? porcelain : 'true' }),
    },
  }
}

describe('adoptOverlay', () => {
  it('fills the CI provider and the test runner from what the repository already has', () => {
    writeFileSync(join(root, 'azure-pipelines.yml'), 'steps: []')
    const { dependencies, received } = fakes()

    adoptOverlay(root, { scope: '@a' }, dependencies)

    expect(received).toEqual([{ scope: '@a', ci: 'azure', testRunner: 'jest' }])
  })

  it('reads both providers when both pipelines exist, and lets a flag win', () => {
    writeFileSync(join(root, 'azure-pipelines.yml'), 'steps: []')
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'on: push')
    const both = fakes()
    const flagged = fakes()

    adoptOverlay(root, {}, both.dependencies)
    adoptOverlay(root, { ci: 'github', testRunner: 'vitest' }, flagged.dependencies)

    expect(both.received[0].ci).toBe('both')
    expect(flagged.received[0]).toMatchObject({ ci: 'github', testRunner: 'vitest' })
  })

  it('refuses a dirty tree before applying anything', () => {
    const { dependencies, received } = fakes(' M a.ts')

    expect(() => adoptOverlay(root, {}, dependencies)).toThrow('uncommitted changes')
    expect(received).toEqual([])
  })

  it('refuses a repository with no nx.json, and says Nx is not installed by adopt', () => {
    rmSync(join(root, 'nx.json'))

    expect(() => adoptOverlay(root, {}, fakes().dependencies)).toThrow('Run `mnci adopt --toolchain` first')
  })
})
