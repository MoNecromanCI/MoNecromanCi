jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runFormatter: jest.fn(),
  runShell:     jest.fn(() => 0),
}))
jest.mock('../terminal', () => ({
  ...jest.requireActual('../terminal'),
  promptText: jest.fn(),
}))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAdd } from './add-project.use-case'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-bicep-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

/**
 * Reads a file of the generated project.
 *
 * @param relative - Path inside `apps/infra`.
 * @returns Its text.
 * @throws Error when the file is missing.
 * @typeParam None - this function has no generic type parameters.
 */
function read (relative: string): string {
  return readFileSync(join(workspaceRoot, 'apps/infra', relative), 'utf8')
}

describe('runAdd bicep-iac', () => {
  it('writes the template, its parameter file, a linter config and a project.json tagged with the kind', async () => {
    await runAdd('bicep-iac', 'infra', {})

    expect(read('main.bicep')).toContain("resource storage 'Microsoft.Storage/storageAccounts@2023-05-01'")
    expect(read('main.bicepparam')).toContain("using './main.bicep'")
    expect(JSON.parse(read('bicepconfig.json')).analyzers.core.rules['no-unused-params'].level).toBe('error')
    expect(JSON.parse(read('project.json'))).toMatchObject({ name: 'infra', tags: ['type:bicep-iac'] })
  })

  it('has lint, build and package targets that go through az bicep, and no test target', async () => {
    await runAdd('bicep-iac', 'infra', {})

    const { targets } = JSON.parse(read('project.json'))
    expect(Object.keys(targets)).toEqual(['lint', 'build', 'package'])
    expect(targets.lint.options.command).toBe('az bicep lint --file main.bicep')
    expect(targets.build.options.commands).toEqual([
      'az bicep build --file main.bicep --outdir ../../dist/apps/infra',
      'az bicep build-params --file main.bicepparam --outfile ../../dist/apps/infra/main.parameters.json',
    ])
    expect(targets.package.dependsOn).toEqual(['build'])
  })

  it('--empty declares no resource', async () => {
    await runAdd('bicep-iac', 'infra', { empty: true })

    expect(read('main.bicep')).not.toContain('resource ')
  })

  it('has a qa that lints and builds, since there is no test', async () => {
    await runAdd('bicep-iac', 'infra', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['infra:qa']).toBe('nx run infra:lint && nx run infra:build')
    expect(scripts['infra:build']).toBe('nx run infra:build')
    expect(scripts['infra:test']).toBeUndefined()
  })

  it('refuses a folder that already exists, and leaves it alone', async () => {
    mkdirSync(join(workspaceRoot, 'apps/infra'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/infra/keep.txt'), 'mine')

    await expect(runAdd('bicep-iac', 'infra', {})).rejects.toThrow('apps/infra already exists.')
    expect(existsSync(join(workspaceRoot, 'apps/infra/main.bicep'))).toBe(false)
  })
})
