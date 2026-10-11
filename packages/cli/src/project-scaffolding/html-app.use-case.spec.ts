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

/** What `create-vite --template vanilla-ts` writes, as far as the repairs need it. */
function writeTemplate (): void {
  const root = join(workspaceRoot, 'apps/site')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'public'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name:            'site',
    private:         true,
    devDependencies: { typescript: '~6.0.2', vite: '^8.3.0' },
  }))
  for (const file of ['index.html', 'src/main.ts', 'src/counter.ts', 'src/style.css', 'src/typescript.svg', 'public/vite.svg', '.gitignore']) {
    writeFileSync(join(root, file), 'template')
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-html-app-'))
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

describe('runAdd html-app', () => {
  it('scaffolds with the pinned create-vite vanilla-ts template', async () => {
    await runAdd('html-app', 'site', {})

    expect(mockRunNpx).toHaveBeenCalledWith(
      ['create-vite@9.2.1', 'apps/site', '--template', 'vanilla-ts', '--no-interactive'],
      workspaceRoot,
    )
  })

  it('installs jQuery into the app as a runtime dependency, and its types and test tooling as dev dependencies', async () => {
    await runAdd('html-app', 'site', {})

    const root = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'))
    expect(root.workspaces).toEqual(['packages/*', 'apps/*'])
    const installs = mockRunShell.mock.calls.map(call => call[1])
    expect(installs[0]).toEqual(['install'])
    expect(installs[1]).toEqual(['install', '-w', 'apps/site', 'jquery'])
    expect(installs[2]).toEqual(['install', '--save-dev', '-w', 'apps/site', '@types/jquery', 'vitest', 'jsdom'])
  })

  it('drops the template sample and its own copy of the compiler, and writes the page and the greeting feature', async () => {
    await runAdd('html-app', 'site', {})

    const app = join(workspaceRoot, 'apps/site')
    for (const gone of ['src/counter.ts', 'src/typescript.svg', 'public']) {
      expect(existsSync(join(app, gone))).toBe(false)
    }
    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
    expect(manifest.devDependencies.typescript).toBeUndefined()
    expect(readFileSync(join(app, 'index.html'), 'utf8')).toContain('<form id="greeting-form">')
    expect(readFileSync(join(app, 'src/main.ts'), 'utf8')).toContain("bindGreeting($('#app'))")
    expect(existsSync(join(app, 'src/greeting/greeting.handler.ts'))).toBe(true)
    expect(readFileSync(join(app, 'vite.config.ts'), 'utf8')).toContain("environment: 'jsdom'")
  })

  it('--empty keeps an empty page and an entry point that does nothing, and no feature', async () => {
    await runAdd('html-app', 'site', { empty: true })

    const app = join(workspaceRoot, 'apps/site')
    expect(readFileSync(join(app, 'src/main.ts'), 'utf8')).toBe('export {}\n')
    expect(readFileSync(join(app, 'index.html'), 'utf8')).toContain('<main id="app"></main>')
    expect(existsSync(join(app, 'src/greeting'))).toBe(false)
  })

  it('writes the targets nothing infers, with a test target that passes with no tests', async () => {
    await runAdd('html-app', 'site', {})

    const { nx } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/site/package.json'), 'utf8'))
    expect(Object.keys(nx.targets)).toEqual(['build', 'serve', 'test', 'typecheck', 'package'])
    expect(nx.targets.test.options.command).toBe('vitest run --passWithNoTests')
    expect(nx.targets.typecheck.options.command).toBe('tsc --noEmit')
    expect(nx.targets.package.options.command).toContain("addLocalFolder('apps/site/dist')")
  })

  it('registers the per-project scripts, with serve as start and dev', async () => {
    await runAdd('html-app', 'site', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['site:qa']).toBe('nx run site:lint && nx run site:test')
    expect(scripts['site:start']).toBe('nx run site:serve')
    expect(scripts['site:dev']).toBe('nx run site:serve')
  })
})
