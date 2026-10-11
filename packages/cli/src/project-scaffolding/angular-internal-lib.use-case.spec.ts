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
import { runNx } from '../nx-workspace'
import { runAdd } from './add-project.use-case'

const mockRunNx = jest.mocked(runNx)

let workspaceRoot: string
let ignoreFlagDuringRun: (string | undefined)[]

/** What `@nx/angular:library` writes, as far as the repairs need it. */
function writeGeneratedLibrary (): void {
  const root = join(workspaceRoot, 'libs/kit')
  mkdirSync(join(root, 'src/lib/kit'), { recursive: true })
  writeFileSync(join(root, 'project.json'), JSON.stringify({ name: 'kit', targets: {} }))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }))
  writeFileSync(join(root, 'tsconfig.spec.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'node10' } }))
  writeFileSync(join(root, 'tsconfig.lib.json'), JSON.stringify({ compilerOptions: { declaration: true, inlineSources: true } }))
  writeFileSync(join(root, 'jest.config.cts'), "module.exports = { setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'] }")
  writeFileSync(join(root, 'src/test-setup.ts'), 'setup\n')
  writeFileSync(join(root, 'src/index.ts'), "export * from './lib/kit/kit'\n")
  writeFileSync(join(root, 'src/lib/kit/kit.ts'), '')
}

/**
 * The compiler options of a file of the generated library.
 *
 * @param file - The tsconfig file name inside the library.
 * @returns Its `compilerOptions`.
 * @throws Error when the file is missing or not JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function compilerOptionsOf (file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit', file), 'utf8')).compilerOptions
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-angular-lib-'))
  ignoreFlagDuringRun = []
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
  mockRunNx.mockImplementation((arguments_: string[]) => {
    ignoreFlagDuringRun.push(process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP)
    if (arguments_[0] === 'g') {
      writeGeneratedLibrary()
    }
  })
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
  mockRunNx.mockReset()
})

describe('runAdd angular-internal-lib', () => {
  it('delegates to the library generator under the workspace scope, past the TypeScript setup check', async () => {
    delete process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP
    await runAdd('angular-internal-lib', 'kit', {})

    expect(mockRunNx).toHaveBeenNthCalledWith(1, ['add', '@nx/angular'], workspaceRoot)
    expect(mockRunNx).toHaveBeenNthCalledWith(
      2,
      [
        'g',
        '@nx/angular:library',
        'libs/kit',
        '--name=kit',
        '--importPath=@demo/kit',
        '--unitTestRunner=jest',
        '--linter=none',
        '--style=css',
        '--no-interactive',
      ],
      workspaceRoot,
    )
    expect(ignoreFlagDuringRun.slice(0, 2)).toEqual(['true', 'true'])
    expect(process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP).toBeUndefined()
  })

  it('keeps the library composite, which an app that references it needs, and repairs its specs', async () => {
    await runAdd('angular-internal-lib', 'kit', {})

    expect(compilerOptionsOf('tsconfig.json')).not.toHaveProperty('composite')
    expect(compilerOptionsOf('tsconfig.json')).toMatchObject({ lib: ['es2022', 'dom'] })
    expect(compilerOptionsOf('tsconfig.lib.json')).toMatchObject({ declaration: true, inlineSources: false })
    expect(compilerOptionsOf('tsconfig.spec.json')).toMatchObject({ composite: false, module: 'preserve', moduleResolution: 'bundler', rootDir: '../..' })
  })

  it('replaces the lib bucket with a greeting feature behind the barrel, and moves the runner setup out of src', async () => {
    await runAdd('angular-internal-lib', 'kit', {})

    const src = join(workspaceRoot, 'libs/kit/src')
    expect(existsSync(join(src, 'lib'))).toBe(false)
    expect(existsSync(join(src, 'test-setup.ts'))).toBe(false)
    expect(readFileSync(join(src, 'index.ts'), 'utf8')).toContain("export * from './greeting'")
    expect(readFileSync(join(src, 'greeting/greeting.component.ts'), 'utf8')).toContain("selector: 'lib-greeting'")
  })

  it('writes a private manifest named for the import path, a typecheck that builds the library, and a qa without build', async () => {
    await runAdd('angular-internal-lib', 'kit', {})

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/package.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: '@demo/kit', private: true })
    const { targets } = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/project.json'), 'utf8'))
    expect(targets.typecheck.options.commands).toEqual(['tsc --build tsconfig.lib.json', 'tsc --noEmit -p tsconfig.spec.json'])
    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['kit:qa']).toBe('nx run kit:lint && nx run kit:test')
    expect(scripts['kit:build']).toBeUndefined()
  })

  it('--empty leaves a barrel with nothing exported', async () => {
    await runAdd('angular-internal-lib', 'kit', { empty: true })

    const src = join(workspaceRoot, 'libs/kit/src')
    expect(readFileSync(join(src, 'index.ts'), 'utf8')).toBe('export {}\n')
    expect(existsSync(join(src, 'greeting'))).toBe(false)
  })
})
