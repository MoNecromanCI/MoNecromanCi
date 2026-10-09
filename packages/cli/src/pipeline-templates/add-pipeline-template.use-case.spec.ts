jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addPipelineTemplate } from './add-pipeline-template.use-case'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-pipeline-'))
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: { ci: 'github' } }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('addPipelineTemplate (#293)', () => {
  it('writes the template for the workspace\'s provider', () => {
    expect(addPipelineTemplate(workspaceRoot, 'e2e')).toEqual(['.github/workflows/e2e.yml'])
    expect(readFileSync(join(workspaceRoot, '.github/workflows/e2e.yml'), 'utf8')).toContain('nx run-many -t e2e')
  })

  it('writes both providers for a workspace on both, and skips one the template lacks', () => {
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: { ci: 'both' } }))
    mkdirSync(join(workspaceRoot, 'apps/site'), { recursive: true })

    expect(addPipelineTemplate(workspaceRoot, 'package-zip')).toEqual(['.github/workflows/package-zip.yml', 'azure-pipelines/package-zip.yml'])
    expect(addPipelineTemplate(workspaceRoot, 'deploy-pages', { project: 'site' })).toEqual(['.github/workflows/deploy-pages.yml'])
  })

  it('keeps a file that exists unless forced', () => {
    addPipelineTemplate(workspaceRoot, 'e2e')
    writeFileSync(join(workspaceRoot, '.github/workflows/e2e.yml'), '# mine')

    expect(addPipelineTemplate(workspaceRoot, 'e2e')).toEqual([])
    expect(readFileSync(join(workspaceRoot, '.github/workflows/e2e.yml'), 'utf8')).toBe('# mine')
    expect(addPipelineTemplate(workspaceRoot, 'e2e', { force: true })).toEqual(['.github/workflows/e2e.yml'])
  })

  it('refuses an unknown template, a missing or unknown app, and an unsupported provider', () => {
    expect(() => addPipelineTemplate(workspaceRoot, 'nonsense')).toThrow(/Choose one of/)
    expect(() => addPipelineTemplate(workspaceRoot, 'deploy-pages')).toThrow(/--project/)
    expect(() => addPipelineTemplate(workspaceRoot, 'deploy-pages', { project: 'ghost' })).toThrow(/no app named 'ghost'/)
    mkdirSync(join(workspaceRoot, 'apps/site'), { recursive: true })
    expect(() => addPipelineTemplate(workspaceRoot, 'deploy-pages', { project: 'site', ci: 'azure' })).toThrow(/github only/)
    expect(existsSync(join(workspaceRoot, '.github/workflows/deploy-pages.yml'))).toBe(false)
  })

  it('refuses a project name that could break out of the file', () => {
    expect(() => addPipelineTemplate(workspaceRoot, 'deploy-pages', { project: 'x; rm -rf /' })).toThrow(/no app named/)
  })

  it('falls back to the files the repository holds when nx.json records no provider', () => {
    writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
    writeFileSync(join(workspaceRoot, 'azure-pipelines.yml'), '')

    expect(addPipelineTemplate(workspaceRoot, 'e2e')).toEqual(['azure-pipelines/e2e.yml'])
  })
})
