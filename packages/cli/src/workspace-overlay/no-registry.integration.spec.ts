import yaml from 'js-yaml'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOverlay, DEFAULT_STACK, npmrcContent, releaseConfig, resolveNpmAuth } from './overlay.use-case'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'mnci-noregistry-'))
  writeFileSync(join(workspace, 'nx.json'), JSON.stringify({ $schema: 's', namedInputs: {} }))
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: '@org/source', private: true, devDependencies: { nx: '23.0.0' } }))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('a workspace with no registry (#228)', () => {
  it('writes an .npmrc with no auth line and no scope routing', () => {
    const content = npmrcContent({ kind: 'none' }, '@demo')

    expect(content).toContain('publishes no packages')
    expect(content).not.toContain('_authToken')
    expect(content).not.toContain('@demo:registry=')
    expect(content.split('\n').filter(line => !line.startsWith(';') && line.trim() !== '')).toEqual([])
  })

  it('releases only what is tagged for it, with nothing to pre-build under packages/*', () => {
    const release = releaseConfig('github', 'none') as { projects: string[], version: { preVersionCommand: string } }

    expect(release.projects).not.toContain('packages/*')
    expect(release.projects).not.toContain('python-packages/*')
    expect(release.projects).toEqual(expect.arrayContaining(['tag:type:vscode-extension', 'tag:release:go', '!tag:type:go-lib']))
    expect(release.version.preVersionCommand).not.toContain('packages/*')
    expect(release.version.preVersionCommand).toContain('tag:type:vscode-extension')
  })

  it('keeps the packages globs for a registry that publishes', () => {
    expect((releaseConfig('azure', 'npm') as { projects: string[] }).projects).toContain('packages/*')
  })

  it('refuses --npm-auth build-identity, naming the missing registry', () => {
    expect(() => resolveNpmAuth('build-identity', { kind: 'none' }, 'azure')).toThrow(/no registry/)
  })

  it('persists the choice, and both pipelines carry no registry token or preflight secret', () => {
    applyOverlay(workspace, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'none' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })

    const nx = JSON.parse(readFileSync(join(workspace, 'nx.json'), 'utf8')) as { mnci: { registry: { kind: string } }, release: { projects: string[] } }
    expect(nx.mnci.registry).toEqual({ kind: 'none' })
    expect(nx.release.projects).not.toContain('packages/*')
    for (const file of ['azure-pipelines.yml', '.github/workflows/ci.yml']) {
      const text = readFileSync(join(workspace, file), 'utf8')
      expect(() => yaml.load(text)).not.toThrow()
      expect(text).not.toMatch(/NODE_AUTH_TOKEN: .*NPM_TOKEN/)
      expect(text).toContain("NODE_AUTH_TOKEN: ''")
      expect(text).not.toContain('PYPI_TOKEN')
      expect(text).not.toContain('$(PAT)')
    }
    expect(readFileSync(join(workspace, '.npmrc'), 'utf8')).not.toContain('_authToken')
  })
})
