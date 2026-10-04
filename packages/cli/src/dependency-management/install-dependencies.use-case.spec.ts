jest.mock('../nx-workspace', () => ({ runShell: jest.fn(() => 0) }))
jest.mock('../terminal', () => ({
  logger: { info: jest.fn(), step: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runShell } from '../nx-workspace'
import { runInstall } from './install-dependencies.use-case'

const mockRunShell = jest.mocked(runShell)

let workspaceRoot: string

/** Writes a file and the directories above it. */
function seed (relativePath: string, content: string): void {
  const full = join(workspaceRoot, relativePath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-install-'))
  mockRunShell.mockClear()
  mockRunShell.mockReturnValue(0)
  process.exitCode = 0

  // One project per ecosystem, plus the multi-module Go markers.
  seed('package.json', JSON.stringify({ name: 'root', private: true, scripts: { 'python:install': 'echo' } }))
  seed('apps/web/package.json', JSON.stringify({ name: '@x/web' }))
  seed('apps/pysvc/pyproject.toml', '[project]\nname = "pysvc"\ndependencies = []\n')
  seed('apps/flut/pubspec.yaml', 'name: flut\n')
  seed('apps/svc/Svc.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>\n')
  seed('apps/goapi/go.mod', 'module example.com/apps/goapi\n\ngo 1.27\n')
  seed('go.work', 'go 1.27\n\nuse ./apps/goapi\n')
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  process.exitCode = 0
})

describe('mnci install: per-ecosystem dispatch (#291)', () => {
  it('adds an npm package through the native workspace flag, from the root', () => {
    runInstall(workspaceRoot, ['left-pad'], { workspace: ['web'] })

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install', 'left-pad', '-w', 'apps/web'], workspaceRoot)
  })

  it('maps --save-dev to npm --save-dev', () => {
    runInstall(workspaceRoot, ['jest'], { workspace: ['web'], saveDev: true })

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install', 'jest', '--save-dev', '-w', 'apps/web'], workspaceRoot)
  })

  it('runs go get in the project module, then go work sync at the root', () => {
    runInstall(workspaceRoot, ['github.com/foo/bar'], { workspace: ['goapi'] })

    expect(mockRunShell).toHaveBeenCalledWith('go', ['get', 'github.com/foo/bar'], join(workspaceRoot, 'apps/goapi'))
    expect(mockRunShell).toHaveBeenCalledWith('go', ['work', 'sync'], workspaceRoot)
  })

  it('peels a pinned version off a NuGet name@version specifier', () => {
    runInstall(workspaceRoot, ['Newtonsoft.Json@13.0.3'], { workspace: ['svc'] })

    expect(mockRunShell).toHaveBeenCalledWith(
      'dotnet',
      ['add', join(workspaceRoot, 'apps/svc/Svc.csproj'), 'package', 'Newtonsoft.Json', '--version', '13.0.3'],
      workspaceRoot,
    )
  })

  it('omits --version for an unpinned NuGet package', () => {
    runInstall(workspaceRoot, ['Serilog'], { workspace: ['svc'] })

    expect(mockRunShell).toHaveBeenCalledWith(
      'dotnet',
      ['add', join(workspaceRoot, 'apps/svc/Svc.csproj'), 'package', 'Serilog'],
      workspaceRoot,
    )
  })

  it('runs flutter pub add in the project directory, with --dev for a dev dependency', () => {
    runInstall(workspaceRoot, ['mockito'], { workspace: ['flut'], saveDev: true })

    expect(mockRunShell).toHaveBeenCalledWith('flutter', ['pub', 'add', '--dev', 'mockito'], join(workspaceRoot, 'apps/flut'))
  })

  it('edits the project pyproject.toml and runs the editable install for pip', () => {
    runInstall(workspaceRoot, ['flask>=3'], { workspace: ['pysvc'] })

    expect(readFileSync(join(workspaceRoot, 'apps/pysvc/pyproject.toml'), 'utf8')).toContain('"flask>=3"')
    expect(mockRunShell).toHaveBeenCalledWith('npm', ['run', 'python:install'], workspaceRoot)
  })
})

describe('mnci install: target resolution (#291)', () => {
  it('addresses a project by its full directory as well as its basename', () => {
    runInstall(workspaceRoot, ['x'], { workspace: ['apps/web'] })

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install', 'x', '-w', 'apps/web'], workspaceRoot)
  })

  it('installs a single project when given a target but no packages', () => {
    runInstall(workspaceRoot, [], { workspace: ['web'] })

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install', '-w', 'apps/web'], workspaceRoot)
  })

  it('fails, and runs nothing, when the target does not exist', () => {
    runInstall(workspaceRoot, ['x'], { workspace: ['ghost'] })

    expect(process.exitCode).toBe(1)
    expect(mockRunShell).not.toHaveBeenCalled()
  })

  it('refuses a package with no target rather than adding it to the root', () => {
    runInstall(workspaceRoot, ['x'], {})

    expect(process.exitCode).toBe(1)
    expect(mockRunShell).not.toHaveBeenCalled()
  })
})

describe('mnci install: bare install (#291)', () => {
  it('installs every ecosystem present, with go work sync for multi-module Go', () => {
    runInstall(workspaceRoot, [], {})

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install'], workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith('npm', ['run', 'python:install'], workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith('flutter', ['pub', 'get'], workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith('npx', ['nx', 'run-many', '-t', 'restore'], workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith('go', ['work', 'sync'], workspaceRoot)
  })
})
