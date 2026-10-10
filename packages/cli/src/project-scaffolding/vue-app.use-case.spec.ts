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
import { runNx, runShell } from '../nx-workspace'
import { runAdd } from './add-project.use-case'

const mockRunNx = jest.mocked(runNx)
const mockRunShell = jest.mocked(runShell)

let workspaceRoot: string

/** What `@nx/vue:app` writes, as far as the repairs need it. */
function writeGeneratedApp (): void {
  const root = join(workspaceRoot, 'apps/web')
  mkdirSync(join(root, 'src/app'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@demo/web', version: '0.0.1', private: true, nx: { name: 'web' } }))
  writeFileSync(join(root, 'vite.config.mts'), "export default { build: { outDir: './dist' } }")
  writeFileSync(join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { outDir: 'dist', tsBuildInfoFile: 'dist/tsconfig.app.tsbuildinfo' } }))
  writeFileSync(join(root, 'src/main.ts'), "import App from './app/App.vue'\n")
  for (const file of ['src/app/App.vue', 'src/app/NxWelcome.vue', 'src/app/App.spec.ts', 'src/vue-shims.d.ts']) {
    writeFileSync(join(root, file), '')
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-vue-app-'))
  mockRunShell.mockImplementation(() => 0)
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
  mockRunNx.mockImplementation((arguments_: string[]) => {
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

describe('runAdd vue-app', () => {
  it('installs @nx/vue on first use, then delegates to the app generator with Vitest, the only runner it has', async () => {
    await runAdd('vue-app', 'web', {})

    expect(mockRunNx).toHaveBeenNthCalledWith(1, ['add', '@nx/vue'], workspaceRoot)
    expect(mockRunNx).toHaveBeenNthCalledWith(
      2,
      [
        'g',
        '@nx/vue:app',
        'apps/web',
        '--name',
        'web',
        '--bundler=vite',
        '--unitTestRunner=vitest',
        '--linter=none',
        '--e2eTestRunner=none',
        '--formatter=none',
        '--style=css',
        '--routing=false',
        '--no-interactive',
      ],
      workspaceRoot,
    )
  })

  it('installs vue-tsc 3, since 2 cannot read the tsc.js of TypeScript 6', async () => {
    await runAdd('vue-app', 'web', {})

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install', '--save-dev', 'vue-tsc@^3'], workspaceRoot)
  })

  it('replaces the welcome page and shim with a greeting feature, and repoints the entry at the renamed root component', async () => {
    await runAdd('vue-app', 'web', {})

    const src = join(workspaceRoot, 'apps/web/src')
    for (const gone of ['app/NxWelcome.vue', 'app/App.vue', 'app/App.spec.ts', 'vue-shims.d.ts']) {
      expect(existsSync(join(src, gone))).toBe(false)
    }
    expect(readFileSync(join(src, 'app/app.component.vue'), 'utf8')).toContain('<GreetingComponent name="web" />')
    expect(readFileSync(join(src, 'greeting/greet.use-case.ts'), 'utf8')).toContain('Hello, ${name}!')
    expect(readFileSync(join(src, 'main.ts'), 'utf8')).toContain("'./app/app.component.vue'")
  })

  it('--empty keeps the root component and drops the feature', async () => {
    await runAdd('vue-app', 'web', { empty: true })

    const src = join(workspaceRoot, 'apps/web/src')
    expect(existsSync(join(src, 'app/app.component.vue'))).toBe(true)
    expect(existsSync(join(src, 'greeting'))).toBe(false)
  })

  it('moves tsc output out of the folder Vite empties, and adds the package target', async () => {
    await runAdd('vue-app', 'web', {})

    const tsconfig = JSON.parse(readFileSync(join(workspaceRoot, 'apps/web/tsconfig.app.json'), 'utf8'))
    expect(tsconfig.compilerOptions.outDir).toBe('out-tsc/app')
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'apps/web/package.json'), 'utf8'))
    expect(manifest.nx.targets.package.options.command).toContain("addLocalFolder('apps/web/dist')")
    expect(manifest.nx.targets.package.dependsOn).toEqual(['build'])
  })

  it('registers the per-project scripts, with serve as start and dev', async () => {
    await runAdd('vue-app', 'web', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['web:qa']).toBe('nx run web:lint && nx run web:test')
    expect(scripts['web:start']).toBe('nx run web:serve')
    expect(scripts['web:dev']).toBe('nx run web:serve')
  })
})
