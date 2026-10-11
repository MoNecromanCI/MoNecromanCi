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

/** What `@nx/angular:app` writes, as far as the repairs need it. */
function writeGeneratedApp (): void {
  const root = join(workspaceRoot, 'apps/web')
  mkdirSync(join(root, 'src/app'), { recursive: true })
  writeFileSync(join(root, 'project.json'), JSON.stringify({ name: 'web', targets: { build: {} } }))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { composite: true, emitDeclarationOnly: true } }))
  writeFileSync(join(root, 'tsconfig.spec.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'node10' }, files: ['src/test-setup.ts'] }))
  writeFileSync(join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { outDir: '../../dist/out-tsc' } }))
  writeFileSync(join(root, 'jest.config.cts'), "module.exports = { setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'] }")
  writeFileSync(join(root, 'src/test-setup.ts'), "import 'jest-preset-angular/setup-env/zoneless'\n")
  for (const file of ['nx-welcome.ts', 'app.html', 'app.css', 'app.ts', 'app.spec.ts', 'app.routes.ts', 'app.config.ts']) {
    writeFileSync(join(root, 'src/app', file), '')
  }
}

/**
 * The compiler options of a file of the generated app.
 *
 * @param file - The tsconfig file name inside the app.
 * @returns Its `compilerOptions`.
 * @throws Error when the file is missing or not JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function compilerOptionsOf (file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(workspaceRoot, 'apps/web', file), 'utf8')).compilerOptions
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-angular-app-'))
  ignoreFlagDuringRun = []
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
  mockRunNx.mockImplementation((arguments_: string[]) => {
    ignoreFlagDuringRun.push(process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP)
    if (arguments_[0] === 'g') {
      writeGeneratedApp()
    }
  })
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
  mockRunNx.mockReset()
})

describe('runAdd angular-app', () => {
  it('installs @nx/angular on first use, then delegates to the app generator', async () => {
    await runAdd('angular-app', 'web', {})

    expect(mockRunNx).toHaveBeenNthCalledWith(1, ['add', '@nx/angular'], workspaceRoot)
    expect(mockRunNx).toHaveBeenNthCalledWith(
      2,
      [
        'g',
        '@nx/angular:app',
        'apps/web',
        '--bundler=esbuild',
        '--unitTestRunner=jest',
        '--linter=none',
        '--e2eTestRunner=none',
        '--formatter=none',
        '--style=css',
        '--no-interactive',
      ],
      workspaceRoot,
    )
  })

  it('lets the plugin install and the generator through the unsupported TypeScript setup check, then puts it back', async () => {
    delete process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP
    await runAdd('angular-app', 'web', {})

    expect(ignoreFlagDuringRun.slice(0, 2)).toEqual(['true', 'true'])
    expect(process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP).toBeUndefined()
  })

  it('switches the project references off in the app and spec configs, which the Angular compiler cannot read', async () => {
    await runAdd('angular-app', 'web', {})

    expect(compilerOptionsOf('tsconfig.json')).toMatchObject({ composite: false, emitDeclarationOnly: false, lib: ['es2022', 'dom'] })
    expect(compilerOptionsOf('tsconfig.spec.json')).toMatchObject({ composite: false, module: 'preserve', moduleResolution: 'bundler' })
    expect(compilerOptionsOf('tsconfig.app.json')).toMatchObject({ rootDir: 'src' })
  })

  it('moves the runner setup out of src, where only index and main may sit, and repoints what names it', async () => {
    await runAdd('angular-app', 'web', {})

    expect(existsSync(join(workspaceRoot, 'apps/web/src/test-setup.ts'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'apps/web/test-setup.ts'))).toBe(true)
    expect(readFileSync(join(workspaceRoot, 'apps/web/jest.config.cts'), 'utf8')).toContain('<rootDir>/test-setup.ts')
    expect(readFileSync(join(workspaceRoot, 'apps/web/tsconfig.spec.json'), 'utf8')).toContain('"test-setup.ts"')
  })

  it('replaces the welcome page with a greeting feature composed by the root component', async () => {
    await runAdd('angular-app', 'web', {})

    const src = join(workspaceRoot, 'apps/web/src')
    for (const gone of ['app/nx-welcome.ts', 'app/app.html', 'app/app.css', 'app/app.ts', 'app/app.routes.ts']) {
      expect(existsSync(join(src, gone))).toBe(false)
    }
    expect(readFileSync(join(src, 'app/app.component.ts'), 'utf8')).toContain('<app-greeting name="web" />')
    expect(readFileSync(join(src, 'app/app.route.ts'), 'utf8')).toContain('appRoutes')
    expect(readFileSync(join(src, 'greeting/greet.use-case.ts'), 'utf8')).toContain('Hello, ${name}!')
  })

  it('--e2e asks for Playwright and replaces its sample with a test of the greeting, with lint and typecheck as qa', async () => {
    mockRunNx.mockImplementation((arguments_: string[]) => {
      if (arguments_[0] !== 'g') {
        return
      }

      writeGeneratedApp()
      mkdirSync(join(workspaceRoot, 'apps/web-e2e/src'), { recursive: true })
      writeFileSync(join(workspaceRoot, 'apps/web-e2e/src/example.spec.ts'), "expect(h1).toContain('Welcome')")
      writeFileSync(join(workspaceRoot, 'apps/web-e2e/tsconfig.json'), JSON.stringify({ compilerOptions: {} }))
    })

    await runAdd('angular-app', 'web', { e2e: true })

    expect(mockRunNx.mock.calls[1][0]).toContain('--e2eTestRunner=playwright')
    expect(existsSync(join(workspaceRoot, 'apps/web-e2e/src/example.spec.ts'))).toBe(false)
    expect(readFileSync(join(workspaceRoot, 'apps/web-e2e/src/greeting.e2e.spec.ts'), 'utf8')).toContain("getByText('Hello, web!')")
    const e2eTsconfig = JSON.parse(readFileSync(join(workspaceRoot, 'apps/web-e2e/tsconfig.json'), 'utf8'))
    expect(e2eTsconfig.compilerOptions.types).toContain('node')
    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['web-e2e:qa']).toBe('nx run web-e2e:lint && nx run web-e2e:typecheck')
    expect(scripts['web-e2e:start']).toBeUndefined()
  })

  it('--empty keeps the root component and drops the feature', async () => {
    await runAdd('angular-app', 'web', { empty: true })

    const src = join(workspaceRoot, 'apps/web/src')
    expect(existsSync(join(src, 'app/app.component.ts'))).toBe(true)
    expect(existsSync(join(src, 'greeting'))).toBe(false)
  })

  it('gives the app a manifest, a package target, and a typecheck that does not build declarations', async () => {
    await runAdd('angular-app', 'web', {})

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'apps/web/package.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: 'web', private: true })
    const { targets } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/web/project.json'), 'utf8'))
    expect(targets.package.options.command).toContain("addLocalFolder('dist/apps/web/browser')")
    expect(targets.package.dependsOn).toEqual(['build'])
    expect(targets.typecheck.options.commands).toEqual(['tsc --noEmit -p tsconfig.app.json', 'tsc --noEmit -p tsconfig.spec.json'])
  })

  it('registers the per-project scripts, with serve as start and dev', async () => {
    await runAdd('angular-app', 'web', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['web:qa']).toBe('nx run web:lint && nx run web:test')
    expect(scripts['web:start']).toBe('nx run web:serve')
    expect(scripts['web:dev']).toBe('nx run web:serve')
    expect(scripts['web:build:dev']).toBe('nx run web:build:development')
  })
})
