import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjects, runProjects } from './list-projects.use-case'

// The prompts library ships ESM only, which Jest cannot load; nothing here prompts.
jest.mock('@inquirer/prompts', () => ({}))

let workspaceRoot: string

/** Writes a file under the workspace, creating its directory. */
function write (relative: string, contents: string): void {
  mkdirSync(join(workspaceRoot, relative, '..'), { recursive: true })
  writeFileSync(join(workspaceRoot, relative), contents)
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-projects-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('listProjects', () => {
  it('lists each project with its ecosystem, sorted by directory', () => {
    write('nx.json', '{}')
    write('packages/zeta/package.json', '{"name":"zeta"}')
    write('apps/api/go.mod', 'module x\n')

    expect(listProjects(workspaceRoot).map(project => [project.dir, project.ecosystem])).toEqual([
      ['apps/api', 'go'],
      ['packages/zeta', 'npm'],
    ])
  })

  it('takes the kind from the type: tag and the targets from project.json', () => {
    write('apps/api/go.mod', 'module x\n')
    write('apps/api/project.json', JSON.stringify({ tags: ['scope:x', 'type:go-app'], targets: { build: {}, test: {} } }))

    expect(listProjects(workspaceRoot)[0]).toMatchObject({ name: 'api', kind: 'go-app', targets: ['build', 'test'] })
  })

  it('has no kind and no targets for a project without a project.json', () => {
    write('packages/lib/package.json', '{"name":"lib"}')

    expect(listProjects(workspaceRoot)[0]).toMatchObject({ kind: undefined, targets: [] })
  })
})

describe('runProjects', () => {
  it('refuses to run outside a workspace', () => {
    expect(() => runProjects(workspaceRoot, {})).toThrow(/No nx\.json/)
  })

  it('prints one JSON document with --json', () => {
    write('nx.json', '{}')
    write('packages/lib/package.json', '{"name":"lib"}')
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    runProjects(workspaceRoot, { json: true })

    expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual([
      { name: 'lib', dir: 'packages/lib', ecosystem: 'npm', targets: [] },
    ])
  })
})
