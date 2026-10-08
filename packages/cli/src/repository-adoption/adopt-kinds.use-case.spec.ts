// Mocked because this spec reaches sibling slices through their barrels, which transitively load
// @inquirer/prompts: ESM-only, and unparseable by jest as CJS. Nothing here exercises a prompt.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjects } from '../workspace-info'
import { adoptKinds, type KindsDependencies } from './adopt-kinds.use-case'

let root: string

/** Writes a file under the repository, with JSON for an object. */
function write (file: string, content: unknown): void {
  mkdirSync(join(root, file, '..'), { recursive: true })
  writeFileSync(join(root, file), typeof content === 'string' ? content : JSON.stringify(content, undefined, 2))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-kinds-'))
  write('nx.json', {})
  write('packages/web/package.json', { name: '@a/web', dependencies: { react: '^19' } })
  write('packages/web/index.html', '<html></html>')
  write('packages/core/package.json', { name: '@a/core', main: './dist/index.js' })
  write('packages/util/package.json', { name: '@a/util' })
  write('packages/api/go.mod', 'module a/api\n')
  write('packages/api/main.go', 'package main\n\nfunc main() {}\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Reads a JSON file of the repository back. */
function read (file: string): { name?: string, tags?: string[], nx?: { tags?: string[] } } {
  return JSON.parse(readFileSync(join(root, file), 'utf8')) as { name?: string, tags?: string[], nx?: { tags?: string[] } }
}

/** A clean git tree. */
const clean: Partial<KindsDependencies> = { capture: (_command, arguments_) => ({ status: 0, stdout: arguments_[0] === 'status' ? '' : 'true' }) }

describe('adoptKinds', () => {
  it('tags what the evidence names, and lists a guess without applying it', () => {
    const outcomes = adoptKinds(root, {}, clean)

    expect(outcomes).toEqual([
      { dir: 'packages/api', outcome: 'tagged', kind: 'go-app', reason: 'a package main' },
      { dir: 'packages/core', outcome: 'tagged', kind: 'npm-lib', reason: 'publishable, with a library entry' },
      { dir: 'packages/util', outcome: 'undecided', kind: 'npm-lib', reason: 'publishable, but no main, module or exports' },
      { dir: 'packages/web', outcome: 'tagged', kind: 'react-app', reason: 'React with an index.html entry' },
    ])
    expect(read('packages/web/package.json').nx.tags).toEqual(['type:react-app'])
    expect(read('packages/api/project.json')).toEqual({ name: 'api', tags: ['type:go-app'] })
    expect(read('packages/util/package.json').nx).toBeUndefined()
  })

  it('applies a guess only when it is named, and then mnci projects shows every kind', () => {
    const outcomes = adoptKinds(root, { 'packages/util': 'internal-lib' }, clean)

    expect(outcomes.find(outcome => outcome.dir === 'packages/util')).toMatchObject({ outcome: 'tagged', kind: 'internal-lib', reason: 'named with --kind' })
    expect(listProjects(root).map(project => [project.dir, project.kind])).toEqual([
      ['packages/api', 'go-app'],
      ['packages/core', 'npm-lib'],
      ['packages/util', 'internal-lib'],
      ['packages/web', 'react-app'],
    ])
  })

  it('keeps a tag that is already there, and does nothing the second time', () => {
    adoptKinds(root, { 'packages/util': 'internal-lib' }, clean)
    const again = adoptKinds(root, {}, clean)

    expect(again.every(outcome => outcome.outcome === 'already')).toBe(true)
    expect(read('packages/web/package.json').nx.tags).toEqual(['type:react-app'])
  })

  it('refuses a kind that does not exist and a project that does not exist, before writing anything', () => {
    expect(() => adoptKinds(root, { 'packages/util': 'mystery' }, clean)).toThrow('not a kind')
    expect(() => adoptKinds(root, { 'packages/nope': 'npm-lib' }, clean)).toThrow('no project at packages/nope')
    expect(read('packages/web/package.json').nx).toBeUndefined()
  })

  it('refuses a dirty tree', () => {
    const dirty: Partial<KindsDependencies> = { capture: (_command, arguments_) => ({ status: 0, stdout: arguments_[0] === 'status' ? ' M a' : 'true' }) }

    expect(() => adoptKinds(root, {}, dirty)).toThrow('uncommitted changes')
  })
})
