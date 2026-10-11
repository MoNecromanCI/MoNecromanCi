jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runNpx:       jest.fn(),
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
import { runNpx, runShell } from '../nx-workspace'
import { runAdd } from './add-project.use-case'

const mockRunNpx = jest.mocked(runNpx)
const mockRunShell = jest.mocked(runShell)

let workspaceRoot: string

/** What `create-vite --template svelte-ts` writes, as far as the repairs need it. */
function writeTemplate (): void {
  const root = join(workspaceRoot, 'apps/web')
  mkdirSync(join(root, 'src/lib'), { recursive: true })
  mkdirSync(join(root, 'src/assets'), { recursive: true })
  mkdirSync(join(root, 'public'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name:            'web',
    private:         true,
    devDependencies: { svelte: '^5.57.0', typescript: '~6.0.2', vite: '^8.3.0' },
  }))
  for (const file of ['src/App.svelte', 'src/app.css', 'src/main.ts', 'src/lib/Counter.svelte', 'README.md', '.gitignore', 'vite.config.ts']) {
    writeFileSync(join(root, file), 'template')
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-svelte-app-'))
  mockRunShell.mockImplementation(() => 0)
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', workspaces: ['packages/*'], devDependencies: {} }))
  mockRunNpx.mockImplementation(() => {
    writeTemplate()
  })
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
  mockRunNpx.mockReset()
})

describe('runAdd svelte-app', () => {
  it('scaffolds with the pinned create-vite svelte-ts template, as no Nx plugin for Svelte installs', async () => {
    await runAdd('svelte-app', 'web', {})

    expect(mockRunNpx).toHaveBeenCalledWith(
      ['create-vite@9.2.1', 'apps/web', '--template', 'svelte-ts', '--no-interactive'],
      workspaceRoot,
    )
  })

  it('registers apps/* as a workspace, links it with a plain install, then installs the test tooling into the app', async () => {
    await runAdd('svelte-app', 'web', {})

    const root = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'))
    expect(root.workspaces).toEqual(['packages/*', 'apps/*'])
    const installs = mockRunShell.mock.calls.map(call => call[1])
    expect(installs[0]).toEqual(['install'])
    expect(installs[1]).toEqual(['install', '--save-dev', '-w', 'apps/web', 'vitest', 'jsdom', '@testing-library/svelte'])
  })

  it('drops the template sample and its own copy of the compiler, and writes the greeting feature', async () => {
    await runAdd('svelte-app', 'web', {})

    const app = join(workspaceRoot, 'apps/web')
    for (const gone of ['src/App.svelte', 'src/lib', 'src/assets', 'README.md']) {
      expect(existsSync(join(app, gone))).toBe(false)
    }
    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
    expect(manifest.devDependencies.typescript).toBeUndefined()
    expect(readFileSync(join(app, 'src/app/app.component.svelte'), 'utf8')).toContain('<GreetingComponent name="web" />')
    expect(readFileSync(join(app, 'src/main.ts'), 'utf8')).toContain("'./app/app.component.svelte'")
    expect(readFileSync(join(app, 'vite.config.ts'), 'utf8')).toContain('svelteTesting()')
  })

  it('--empty keeps the root component and drops the feature', async () => {
    await runAdd('svelte-app', 'web', { empty: true })

    const src = join(workspaceRoot, 'apps/web/src')
    expect(existsSync(join(src, 'app/app.component.svelte'))).toBe(true)
    expect(existsSync(join(src, 'greeting'))).toBe(false)
  })

  it('writes the targets nothing infers: build, serve, test, svelte-check typecheck and a package zip', async () => {
    await runAdd('svelte-app', 'web', {})

    const { nx } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/web/package.json'), 'utf8'))
    expect(Object.keys(nx.targets)).toEqual(['build', 'serve', 'test', 'typecheck', 'package'])
    expect(nx.targets.typecheck.options.command).toContain('svelte-check')
    expect(nx.targets.test.options.command).toBe('vitest run')
    expect(nx.targets.package.options.command).toContain("addLocalFolder('apps/web/dist')")
  })

  it('registers the per-project scripts, with serve as start and dev', async () => {
    await runAdd('svelte-app', 'web', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['web:qa']).toBe('nx run web:lint && nx run web:test')
    expect(scripts['web:start']).toBe('nx run web:serve')
    expect(scripts['web:dev']).toBe('nx run web:serve')
  })
})
