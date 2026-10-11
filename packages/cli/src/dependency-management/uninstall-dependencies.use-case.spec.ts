jest.mock('../nx-workspace', () => ({ runShell: jest.fn(() => 0) }))
jest.mock('../lockfile-completion', () => ({ completeLockfile: jest.fn() }))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runShell } from '../nx-workspace'
import { completeLockfile } from '../lockfile-completion'
import { runUninstall } from './uninstall-dependencies.use-case'

const mockRunShell = jest.mocked(runShell)

let root: string

function project (dir: string, manifestName: string, content: string): void {
  mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, manifestName), content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-uninstall-'))
  mockRunShell.mockClear()
  jest.mocked(completeLockfile).mockClear()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  process.exitCode = undefined
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  jest.restoreAllMocks()
  process.exitCode = undefined
})

describe('runUninstall', () => {
  it('removes from one npm project through the workspace flag and completes the lockfile', () => {
    project('apps/web', 'package.json', JSON.stringify({ name: 'web', dependencies: { zod: '^4' } }))

    runUninstall(root, ['zod'], { workspace: ['web'] })

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['uninstall', 'zod', '-w', 'apps/web'], root)
    expect(completeLockfile).toHaveBeenCalledWith(root)
  })

  it('refuses a package with no target project, so it is never taken from the root', () => {
    runUninstall(root, ['zod'], {})

    expect(mockRunShell).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('refuses no package at all', () => {
    project('apps/web', 'package.json', JSON.stringify({ name: 'web' }))

    runUninstall(root, [], { workspace: ['web'] })

    expect(mockRunShell).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('names an unknown project and fails', () => {
    runUninstall(root, ['zod'], { workspace: ['nope'] })

    expect(mockRunShell).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('edits pyproject.toml for a Python project, since pip has no remove-from-manifest verb', () => {
    project('apps/svc', 'pyproject.toml', '[project]\nname = "svc"\ndependencies = ["requests>=2", "pydantic"]\n')

    runUninstall(root, ['requests'], { workspace: ['svc'] })

    expect(readFileSync(join(root, 'apps/svc/pyproject.toml'), 'utf8')).toContain('dependencies = ["pydantic"]')
    expect(mockRunShell).not.toHaveBeenCalled()
  })

  it('uses go get <pkg>@none in the module for a Go project, then syncs the workspace', () => {
    project('apps/api', 'go.mod', 'module example.com/api\n\ngo 1.22\n')

    runUninstall(root, ['github.com/google/uuid'], { workspace: ['api'] })

    expect(mockRunShell).toHaveBeenCalledWith('go', ['get', 'github.com/google/uuid@none'], join(root, 'apps/api'))
    expect(mockRunShell).toHaveBeenCalledWith('go', ['work', 'sync'], root)
  })
})
