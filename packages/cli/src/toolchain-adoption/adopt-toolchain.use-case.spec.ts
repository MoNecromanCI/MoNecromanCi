// Mocked because this spec reaches sibling slices through their barrels, which transitively load
// @inquirer/prompts: ESM-only, and unparseable by jest as CJS. Nothing here exercises a prompt.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adoptToolchain, type ToolchainDependencies } from './adopt-toolchain.use-case'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-toolchain-'))
  writeFileSync(join(root, '.prettierrc'), '{}')
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts:         { 'build': 'nx build', 'format:check': 'oxfmt --check .' },
    devDependencies: { 'nx': '23.1.1', '@nx/js': '23.1.1', '@nx/node': '^23.1.1', 'prettier': '^3.0.0' },
  }))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A runner that records commands, is on a clean git tree, and lists the published nx versions. */
function fakes (auditResults: number[]): { dependencies: ToolchainDependencies, commands: string[] } {
  const commands: string[] = []
  const results = [...auditResults]

  return {
    commands,
    dependencies: {
      run: (command, arguments_) => {
        commands.push([command, ...arguments_].join(' '))

        return 0
      },
      capture: (command, arguments_) => {
        const line = [command, ...arguments_].join(' ')
        if (line.startsWith('git status')) return { status: 0, stdout: '' }
        if (line.startsWith('git rev-parse')) return { status: 0, stdout: 'true' }
        if (line.startsWith('npm view nx')) return { status: 0, stdout: JSON.stringify(['23.1.1', '23.3.0', '24.0.0']) }

        return { status: 1, stdout: '' }
      },
      audit: () => results.shift() ?? 0,
      log:   () => {},
    },
  }
}

describe('adoptToolchain', () => {
  it('retires the old tooling, aligns the Nx family, and runs audit fix until the gate passes', () => {
    const { dependencies, commands } = fakes([1, 1, 0])

    const result = adoptToolchain(root, {}, dependencies)

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string>, devDependencies: Record<string, string> }
    expect(manifest.devDependencies).toEqual({ 'nx': '23.3.0', '@nx/js': '23.3.0', '@nx/node': '23.3.0' })
    expect(manifest.scripts).toEqual({ build: 'nx build' })
    expect(result).toMatchObject({ aligned: { version: '23.3.0' }, auditFixes: 2, auditPasses: true })
    expect(result.removed).toEqual(expect.arrayContaining(['.prettierrc', 'devDependencies: prettier']))
    expect(commands.filter(command => command === 'npm audit fix --no-fund')).toHaveLength(2)
    expect(commands.some(command => command.includes('--force'))).toBe(false)
  })

  it('sets Nx up first, through nx init and nx add, when the repository has no nx.json', () => {
    const { dependencies, commands } = fakes([0])

    const result = adoptToolchain(root, {}, dependencies)

    expect(result.bootstrapped).toEqual(['@nx/js'])
    expect(commands[0]).toBe('npx --yes nx@latest init --interactive=false --nxCloud=skip --plugins=skip')
    expect(commands[1]).toBe('npx nx add @nx/js')
  })

  it('does not set Nx up in a repository that already has it', () => {
    writeFileSync(join(root, 'nx.json'), '{}')
    const { dependencies, commands } = fakes([0])

    expect(adoptToolchain(root, {}, dependencies).bootstrapped).toEqual([])
    expect(commands.some(command => command.includes('nx init'))).toBe(false)
  })

  it('stops after four passes and says the audit still fails', () => {
    const { dependencies } = fakes([1, 1, 1, 1, 1, 1])

    expect(adoptToolchain(root, {}, dependencies)).toMatchObject({ auditFixes: 4, auditPasses: false })
  })

  it('aligns to the version asked for', () => {
    const { dependencies } = fakes([0])

    expect(adoptToolchain(root, { nxVersion: '23.2.0' }, dependencies).aligned.version).toBe('23.2.0')
  })

  it('refuses a dirty working tree, before changing anything', () => {
    const { dependencies } = fakes([0])
    dependencies.capture = (command, arguments_) => ({ status: 0, stdout: [command, ...arguments_].join(' ').startsWith('git status') ? ' M a.ts' : 'true' })

    expect(() => adoptToolchain(root, {}, dependencies)).toThrow('uncommitted changes')
    expect(readFileSync(join(root, '.prettierrc'), 'utf8')).toBe('{}')
  })
})
