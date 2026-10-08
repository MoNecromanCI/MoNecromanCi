// Mocked because this spec reaches sibling slices through their barrels, which transitively load
// @inquirer/prompts: ESM-only, and unparseable by jest as CJS. Nothing here exercises a prompt.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectRepository } from './inspect-repository.use-case'
import { reportAdoption } from './report-adoption.use-case'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-adopt-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('inspectRepository', () => {
  it('reads the facts of a repository that is not a git work tree, changing nothing', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      devDependencies: { prettier: '^3.0.0', nx: '23.1.1' },
      scripts:         { 'format:check': 'oxfmt --check .' },
    }))
    writeFileSync(join(root, 'package-lock.json'), '{}')
    writeFileSync(join(root, 'azure-pipelines.yml'), 'steps: []')
    writeFileSync(join(root, 'CLAUDE.md'), '# mine')
    writeFileSync(join(root, '.prettierrc'), '{}')
    mkdirSync(join(root, 'packages', 'a'), { recursive: true })
    writeFileSync(join(root, 'packages', 'a', 'package.json'), JSON.stringify({ name: '@x/a' }))

    const facts = inspectRepository(root)

    expect(facts).toMatchObject({
      packageManager:   'npm',
      nxVersion:        '23.1.1',
      alreadyMnci:      false,
      ci:               ['azure'],
      pipelineUsesMnci: false,
      personalFiles:    ['CLAUDE.md'],
    })
    expect(facts.projects.map(project => project.dir)).toEqual(['packages/a'])
    expect(facts.retiredTooling.toSorted((a, b) => a.localeCompare(b))).toEqual(['.prettierrc', 'oxfmt', 'prettier'])
  })

  it('reports a directory that is not a git repository as a blocker', () => {
    writeFileSync(join(root, 'package.json'), '{}')

    const report = reportAdoption(root)

    expect(report.ready).toBe(false)
    expect(report.findings[0].detail).toContain('not a git repository')
  })

  it('recognises a pipeline that already calls mnci ci', () => {
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'azure-pipelines.yml'), '- script: npx mnci ci verify')

    expect(inspectRepository(root).pipelineUsesMnci).toBe(true)
  })
})
