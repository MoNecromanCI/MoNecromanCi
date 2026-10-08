import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapNx } from './bootstrap-nx.use-case'

let root: string
let commands: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-bootstrap-'))
  commands = []
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^9', jest: '^30', typescript: '^5' } }))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A runner that records the commands and answers with a status. */
function runner (status = 0): { run: (command: string, arguments_: string[]) => number } {
  return {
    run: (command, arguments_) => {
      commands.push([command, ...arguments_].join(' '))

      return status
    },
  }
}

describe('bootstrapNx', () => {
  it('initialises Nx without plugins, then adds the TypeScript plugin and one for each tool the repository uses', () => {
    const result = bootstrapNx(root, undefined, runner())

    expect(result).toEqual({ bootstrapped: true, plugins: ['@nx/js', '@nx/eslint', '@nx/jest'] })
    expect(commands).toEqual([
      'npx --yes nx@latest init --interactive=false --nxCloud=skip --plugins=skip',
      'npx nx add @nx/js',
      'npx nx add @nx/eslint',
      'npx nx add @nx/jest',
    ])
  })

  it('installs the Nx version it is given', () => {
    bootstrapNx(root, '23.3.0', runner())

    expect(commands[0]).toContain('nx@23.3.0 init')
  })

  it('adds only the TypeScript plugin when the repository uses none of the tools', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { typescript: '^5' } }))

    expect(bootstrapNx(root, undefined, runner()).plugins).toEqual(['@nx/js'])
  })

  it('does nothing in a repository that already has an nx.json', () => {
    writeFileSync(join(root, 'nx.json'), '{}')

    expect(bootstrapNx(root, undefined, runner())).toEqual({ bootstrapped: false, plugins: [] })
    expect(commands).toEqual([])
  })

  it('stops with a message when nx init fails, before adding any plugin', () => {
    expect(() => bootstrapNx(root, undefined, runner(1))).toThrow('`nx init` failed')
    expect(commands).toHaveLength(1)
  })
})
