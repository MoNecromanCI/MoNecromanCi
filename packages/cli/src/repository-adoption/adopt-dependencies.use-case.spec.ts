// Mocked because this spec reaches sibling slices through their barrels, which transitively load
// @inquirer/prompts: ESM-only, and unparseable by jest as CJS. Nothing here exercises a prompt.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adoptDependencies, type DependenciesDependencies } from './adopt-dependencies.use-case'

let root: string
let commands: string[]

/** Writes a file under the repository, with JSON for an object. */
function write (file: string, content: unknown): void {
  mkdirSync(join(root, file, '..'), { recursive: true })
  writeFileSync(join(root, file), typeof content === 'string' ? content : JSON.stringify(content, undefined, 2))
}

/** Reads a manifest back. */
function manifest (file: string): { dependencies?: Record<string, string>, devDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(root, file), 'utf8')) as { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-deps-'))
  commands = []
  write('package.json', {
    name:            'source',
    private:         true,
    workspaces:      ['packages/*'],
    dependencies:    { 'axios': '^1.6.0', 'zod': '^3.22.0', 'only-tooling': '^1.0.0' },
    devDependencies: { jest: '^30.0.0' },
  })
  write('packages/api/package.json', { name: '@a/api' })
  write('packages/api/src/index.ts', "import axios from 'axios'\nimport { z } from 'zod/v3'\nexport const x = [axios, z]\n")
  write('packages/web/package.json', { name: '@a/web', dependencies: { axios: '^0.27.0' } })
  write('packages/web/src/app.ts', "import axios from 'axios'\nexport default axios\n")
  write('packages/web/src/app.spec.ts', "import { z } from 'zod'\nexport const t = z\n")
  write('packages/web/node_modules/zod/index.js', "require('only-tooling')\n")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A clean git tree, and an install that succeeds. */
const clean: Partial<DependenciesDependencies> = {
  capture: (_command, arguments_) => ({ status: 0, stdout: arguments_[0] === 'status' ? '' : 'true' }),
  run:     (command, arguments_) => {
    commands.push([command, ...arguments_].join(' '))

    return 0
  },
}

describe('adoptDependencies', () => {
  it('moves each root dependency into the projects that import it, and out of the root', () => {
    const { plan, installed } = adoptDependencies(root, clean)

    expect(manifest('packages/api/package.json').dependencies).toEqual({ axios: '^1.6.0', zod: '^3.22.0' })
    expect(manifest('packages/web/package.json').devDependencies).toEqual({ zod: '^3.22.0' })
    expect(manifest('package.json').dependencies).toEqual({ 'only-tooling': '^1.0.0' })
    expect(manifest('package.json').devDependencies).toEqual({ jest: '^30.0.0' })
    expect(plan.removed).toEqual(['axios', 'zod'])
    expect(installed).toBe(true)
    expect(commands).toEqual(['npm install --ignore-scripts --no-audit --no-fund'])
  })

  it('keeps the range a project already declared, and says so', () => {
    const { plan } = adoptDependencies(root, clean)

    expect(manifest('packages/web/package.json').dependencies).toEqual({ axios: '^0.27.0' })
    expect(plan.conflicts).toEqual([{ name: 'axios', dir: 'packages/web', projectRange: '^0.27.0', rootRange: '^1.6.0' }])
  })

  it('lists what no project imports instead of moving or deleting it, and ignores node_modules', () => {
    const { plan } = adoptDependencies(root, clean)

    expect(plan.keptAtRoot.map(entry => entry.name)).toEqual(['only-tooling'])
  })

  it('has nothing to do, and installs nothing, when the root has no runtime dependencies', () => {
    write('package.json', { name: 'source', private: true, workspaces: ['packages/*'] })

    expect(adoptDependencies(root, clean).plan.moves).toEqual([])
    expect(commands).toEqual([])
  })

  it('refuses a dirty tree before changing anything', () => {
    const dirty: Partial<DependenciesDependencies> = { capture: (_command, arguments_) => ({ status: 0, stdout: arguments_[0] === 'status' ? ' M a' : 'true' }) }

    expect(() => adoptDependencies(root, dirty)).toThrow('uncommitted changes')
    expect(manifest('package.json').dependencies).toHaveProperty('axios')
  })
})
