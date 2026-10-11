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

/** What `create-astro --template starlight` writes, as far as the repairs need it. */
function writeTemplate (): void {
  const root = join(workspaceRoot, 'apps/site')
  mkdirSync(join(root, 'src/content/docs/guides'), { recursive: true })
  mkdirSync(join(root, 'src/assets'), { recursive: true })
  mkdirSync(join(root, '.vscode'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'apps-site', version: '0.0.1', dependencies: { astro: '^7' } }))
  for (const file of ['CLAUDE.md', 'AGENTS.md', 'README.md', '.gitignore', 'astro.config.mjs', 'src/content.config.ts', 'src/content/docs/index.mdx', 'src/content/docs/guides/example.md']) {
    writeFileSync(join(root, file), 'template')
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-docs-site-'))
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

describe('runAdd docs-site', () => {
  it('scaffolds with the pinned create-astro Starlight template and installs nothing itself', async () => {
    await runAdd('docs-site', 'site', {})

    expect(mockRunNpx).toHaveBeenCalledWith(
      ['create-astro@5.2.6', 'apps/site', '--template', 'starlight', '--no-install', '--no-git', '--yes', '--skip-houston'],
      workspaceRoot,
    )
  })

  it('removes the template files that are about the template, and keeps its .gitignore', async () => {
    await runAdd('docs-site', 'site', {})

    const site = join(workspaceRoot, 'apps/site')
    for (const gone of ['CLAUDE.md', 'AGENTS.md', 'README.md', '.vscode', 'src/assets', 'src/content/docs/guides/example.md']) {
      expect(existsSync(join(site, gone))).toBe(false)
    }
    expect(existsSync(join(site, '.gitignore'))).toBe(true)
  })

  it('names the site and writes a landing page, a guide and a reference page', async () => {
    await runAdd('docs-site', 'site', {})

    const site = join(workspaceRoot, 'apps/site')
    expect(readFileSync(join(site, 'astro.config.mjs'), 'utf8')).toContain('title: "site"')
    expect(existsSync(join(site, 'src/content/docs/index.mdx'))).toBe(true)
    expect(existsSync(join(site, 'src/content/docs/guides/getting-started.md'))).toBe(true)
    expect(existsSync(join(site, 'src/content/docs/reference/overview.md'))).toBe(true)
  })

  it('registers apps/* as a workspace, links it with a plain install, then installs @astrojs/check into the site', async () => {
    await runAdd('docs-site', 'site', {})

    const root = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'))
    expect(root.workspaces).toEqual(['packages/*', 'apps/*'])
    const installs = mockRunShell.mock.calls.map(call => call[1])
    expect(installs[0]).toEqual(['install'])
    expect(installs[1]).toEqual(['install', '--save-dev', '-w', 'apps/site', '@astrojs/check'])
  })

  it('renames the manifest to the project and writes build, serve, typecheck and package targets, and no test', async () => {
    await runAdd('docs-site', 'site', {})

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'apps/site/package.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: 'site', private: true })
    expect(Object.keys(manifest.nx.targets)).toEqual(['build', 'serve', 'typecheck', 'package'])
    expect(manifest.nx.targets.typecheck.options.command).toBe('astro check')
    expect(manifest.nx.targets.build.dependsOn).toEqual(['typecheck'])
    expect(manifest.nx.targets.package.options.command).toContain("addLocalFolder('apps/site/dist')")
  })

  it('has a qa that lints, type-checks and builds', async () => {
    await runAdd('docs-site', 'site', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['site:qa']).toBe('nx run site:lint && nx run site:typecheck && nx run site:build')
    expect(scripts['site:start']).toBe('nx run site:serve')
  })
})
