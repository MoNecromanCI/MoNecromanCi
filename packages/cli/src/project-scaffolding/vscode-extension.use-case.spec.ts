jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runFormatter: jest.fn(),
  runShell:     jest.fn(() => 0),
}))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNx, runShell } from '../nx-workspace'
import { readCodeWorkspace } from '../file-system'
import { vscodeWorkspace } from '../workspace-overlay'
import { runAdd } from './add-project.use-case'
import {
  pinVscodeExtensionProjectNames,
  refreshVscodeExtensionScript,
  VSCODE_EXTENSION_SCRIPT,
  VSCODE_EXTENSION_SCRIPT_PATH,
  VSCODE_SIDECAR_TARGETS,
} from './vscode-extension.use-case'

const mockRunNx = jest.mocked(runNx)
const mockRunShell = jest.mocked(runShell)

/** What `@nx/node:application --bundler=esbuild` writes, trimmed to what the kind touches. */
function simulateNodeApplication (workspaceRoot: string, name: string, testRunner: 'jest' | 'vitest'): void {
  const root = join(workspaceRoot, 'apps', name)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/main.ts'), "console.log('Hello World')\n")
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name:    `@demo/${name}`,
      version: '0.0.1',
      private: true,
      nx:      {
        targets: {
          'build': {
            executor: '@nx/esbuild:esbuild',
            options:  {
              platform:   'node',
              outputPath: `apps/${name}/dist`,
              format:     ['cjs'],
              bundle:     false,
              main:       `apps/${name}/src/main.ts`,
              assets:     [`apps/${name}/src/assets`],
            },
          },
          'serve':                  { continuous: true, executor: '@nx/js:node' },
          'prune-lockfile':         { executor: '@nx/js:prune-lockfile' },
          'copy-workspace-modules': { executor: '@nx/js:copy-workspace-modules' },
          'prune':                  { executor: 'nx:noop' },
          'test':                   { options: { passWithNoTests: true } },
        },
      },
    }),
  )
  writeFileSync(
    join(root, 'tsconfig.app.json'),
    JSON.stringify({ compilerOptions: { outDir: 'dist', types: ['node'] }, include: ['src/**/*.ts'] }),
  )
  writeFileSync(
    join(root, 'tsconfig.spec.json'),
    JSON.stringify({ compilerOptions: { types: ['jest', 'node'] }, include: ['src/**/*.spec.ts'] }),
  )
  if (testRunner === 'jest') {
    writeFileSync(
      join(root, 'jest.config.cts'),
      "module.exports = {\n  displayName: '@demo/ext',\n  preset: '../../jest.preset.js',\n  testEnvironment: 'node',\n  moduleFileExtensions: ['ts', 'js', 'html'],\n};\n",
    )
  } else {
    writeFileSync(
      join(root, 'vitest.config.mts'),
      "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig(() => ({\n  root: import.meta.dirname,\n  test: {\n    name: '@demo/ext',\n    environment: 'node',\n    include: ['{src,tests}/**/*.{test,spec}.ts'],\n  },\n}));\n",
    )
  }
}

let workspaceRoot: string

function setUp (testRunner: 'jest' | 'vitest' = 'jest'): void {
  writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: { stack: { testRunner } } }))
  mockRunNx.mockImplementation((arguments_) => {
    if (arguments_[0] === 'g' && arguments_[1] === '@nx/node:application') {
      simulateNodeApplication(workspaceRoot, arguments_[2].replace('apps/', ''), testRunner)
    }
  })
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-vscode-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  mockRunShell.mockImplementation((command, arguments_) => {
    // `npm install --save-dev @types/vscode @vscode/vsce`: record it like npm would.
    if (command === 'npm' && arguments_.includes('@types/vscode')) {
      mkdirSync(join(workspaceRoot, 'node_modules/@types/vscode'), { recursive: true })
      writeFileSync(join(workspaceRoot, 'node_modules/@types/vscode/package.json'), JSON.stringify({ version: '1.140.0' }))
    }

    return 0
  })
  writeFileSync(
    join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@demo/source', devDependencies: { '@nx/node': '^23.0.0' } }),
  )
  writeFileSync(join(workspaceRoot, 'demo.code-workspace'), vscodeWorkspace('demo'))
  setUp()
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

function manifest (name = 'ext'): Record<string, any> {
  return JSON.parse(readFileSync(join(workspaceRoot, 'apps', name, 'package.json'), 'utf8'))
}

describe('runAdd vscode-extension', () => {
  it('scaffolds through @nx/node:application, then installs the toolchain at the root', async () => {
    await runAdd('vscode-extension', 'ext', {})

    expect(mockRunNx).toHaveBeenCalledWith(expect.arrayContaining(['g', '@nx/node:application', 'apps/ext', '--framework=none']), workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith(
      'npm',
      ['install', '--save-dev', '@types/vscode', '@vscode/vsce', '--no-audit', '--no-fund'],
      workspaceRoot,
    )
  })

  it('refreshes package-lock.json after unscoping the manifest, or npm ci refuses it (#251)', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const refresh = mockRunShell.mock.calls.findIndex(([command, arguments_]) =>
      command === 'npm' && arguments_.join(' ') === 'install --package-lock-only --no-audit --no-fund')
    expect(refresh).toBeGreaterThan(-1)
    // After the reshape, which is what changed the name the lock is keyed by.
    const toolchain = mockRunShell.mock.calls.findIndex(([, arguments_]) => arguments_.includes('@types/vscode'))
    expect(refresh).toBeGreaterThan(toolchain)
  })

  it('writes an extension manifest vsce accepts', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const written = manifest()
    // vsce rejects a scoped name, and refuses types newer than the engine range.
    expect(written.name).toBe('ext')
    expect(written.publisher).toBe('demo')
    expect(written.engines).toEqual({ vscode: '^1.140.0' })
    expect(written.main).toBe('./dist/main.js')
    expect(written.activationEvents).toEqual([])
    expect(written.contributes.commands).toEqual([{ command: 'ext.hello', title: 'ext: Hello' }])
    expect(written.nx.tags).toEqual(['type:vscode-extension'])
    // Pins the Nx project name, so renaming the extension later breaks nothing (#247).
    expect(written.nx.name).toBe('ext')
  })

  it('takes the publisher from --publisher', async () => {
    await runAdd('vscode-extension', 'ext', { publisher: 'acme' })

    expect(manifest().publisher).toBe('acme')
  })

  it('bundles the build, keeps vscode external and drops the server-shaped targets', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const { targets } = manifest().nx
    // A .vsix ships no node_modules, so an un-bundled build cannot run in the host.
    expect(targets.build.options).toMatchObject({
      bundle:              true,
      thirdParty:          true,
      external:            ['vscode'],
      generatePackageJson: false,
      platform:            'node',
    })
    for (const gone of ['serve', 'prune', 'prune-lockfile', 'copy-workspace-modules']) {
      expect(targets[gone]).toBeUndefined()
    }
  })

  it('packages one universal vsix and publishes it through the shared script', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const { targets } = manifest().nx
    expect(targets.package).toEqual({
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   ['{workspaceRoot}/dist/drop/ext.vsix'],
      options:   { command: `node ${VSCODE_EXTENSION_SCRIPT_PATH} package apps/ext` },
    })
    // Packages the version nx release just wrote, never a stale one.
    expect(targets['nx-release-publish']).toEqual({
      executor:  'nx:run-commands',
      dependsOn: ['package'],
      options:   { command: `node ${VSCODE_EXTENSION_SCRIPT_PATH} publish apps/ext` },
    })
    expect(readFileSync(join(workspaceRoot, VSCODE_EXTENSION_SCRIPT_PATH), 'utf8')).toBe(VSCODE_EXTENSION_SCRIPT)
  })

  it('packages one vsix per Marketplace target with a Go sidecar', async () => {
    mkdirSync(join(workspaceRoot, 'apps/engine'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/engine/project.json'), '{}')

    await runAdd('vscode-extension', 'ext', { sidecar: 'engine' })

    const { targets } = manifest().nx
    expect(targets.package.outputs).toHaveLength(8)
    expect(targets.package.outputs).toContain('{workspaceRoot}/dist/drop/ext-darwin-arm64.vsix')
    expect(targets.package.options.command).toBe(`node ${VSCODE_EXTENSION_SCRIPT_PATH} package apps/ext --sidecar engine`)
    expect(targets['nx-release-publish'].options.command).toContain('--sidecar engine')
  })

  it('depends on the Go app it ships, so a change to that app\'s libraries releases the extension', async () => {
    // Measured: with no edge, a commit touching only a Go library the sidecar imports left
    // `nx release` seeing "no changes" for the extension, so it was never published.
    mkdirSync(join(workspaceRoot, 'apps/engine'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/engine/project.json'), '{}')

    await runAdd('vscode-extension', 'ext', { sidecar: 'engine' })

    expect((manifest().nx as { implicitDependencies?: string[] }).implicitDependencies).toEqual(['engine'])
  })

  it('declares no dependency for an extension that ships no sidecar', async () => {
    await runAdd('vscode-extension', 'ext', {})

    expect((manifest().nx as { implicitDependencies?: string[] }).implicitDependencies).toBeUndefined()
  })

  it('refuses a sidecar that is not a Go app, before generating anything', async () => {
    await expect(runAdd('vscode-extension', 'ext', { sidecar: 'missing' })).rejects.toThrow('no Go app at apps/missing')
    expect(mockRunNx).not.toHaveBeenCalled()
  })

  it('adds the vscode types to both tsconfigs, since the module is declared ambiently', async () => {
    await runAdd('vscode-extension', 'ext', {})

    for (const file of ['tsconfig.app.json', 'tsconfig.spec.json']) {
      const tsconfig = JSON.parse(readFileSync(join(workspaceRoot, 'apps/ext', file), 'utf8'))
      expect(tsconfig.compilerOptions.types).toContain('vscode')
    }
  })

  it('maps vscode to the stub for Jest', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const config = readFileSync(join(workspaceRoot, 'apps/ext/jest.config.cts'), 'utf8')
    expect(config).toContain("  testEnvironment: 'node',\n  moduleNameMapper: { '^vscode$': '<rootDir>/test/vscode.stub.ts' },\n")
    expect(existsSync(join(workspaceRoot, 'apps/ext/test/vscode.stub.ts'))).toBe(true)
  })

  it('maps vscode to the stub for Vitest', async () => {
    setUp('vitest')

    await runAdd('vscode-extension', 'ext', {})

    const config = readFileSync(join(workspaceRoot, 'apps/ext/vitest.config.mts'), 'utf8')
    expect(config).toContain("    environment: 'node',\n    alias: { vscode: `${import.meta.dirname}/test/vscode.stub.ts` },\n")
  })

  it('fails loudly when the test config has no anchor to map vscode after', async () => {
    mockRunNx.mockImplementation((arguments_) => {
      if (arguments_[0] !== 'g') return
      simulateNodeApplication(workspaceRoot, 'ext', 'jest')
      writeFileSync(join(workspaceRoot, 'apps/ext/jest.config.cts'), 'module.exports = {}\n')
    })

    await expect(runAdd('vscode-extension', 'ext', {})).rejects.toThrow("map 'vscode' to test/vscode.stub.ts by hand")
  })

  it('writes the sample, its spec and a .vscodeignore that keeps bin/ in the package', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const root = join(workspaceRoot, 'apps/ext')
    expect(readFileSync(join(root, 'src/main.ts'), 'utf8')).toContain("registerCommand('ext.hello'")
    expect(readFileSync(join(root, 'src/main.spec.ts'), 'utf8')).toContain("toContain('ext.hello')")
    const ignore = readFileSync(join(root, '.vscodeignore'), 'utf8').split('\n')
    expect(ignore).toEqual(expect.arrayContaining(['src/**', 'test/**', '**/*.d.ts', '**/*.map', 'node_modules/**']))
    expect(ignore.some(line => line.startsWith('bin'))).toBe(false)
  })

  it('adds a debug launch and its build task that survive mnci upgrade', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const path = join(workspaceRoot, 'demo.code-workspace')
    type File = {
      tasks:  { tasks: Record<string, unknown>[] }
      launch: { configurations: Record<string, unknown>[] }
    }
    const written = readCodeWorkspace<File>(path)!
    const debug = written.launch.configurations.find(entry => entry.name === 'ext: debug')
    expect(debug).toEqual({
      name:          'ext: debug',
      type:          'extensionHost',
      request:       'launch',
      args:          ['--extensionDevelopmentPath=${workspaceFolder:demo}/apps/ext'],
      outFiles:      ['${workspaceFolder:demo}/apps/ext/dist/**/*.js'],
      preLaunchTask: 'ext: build (development)',
    })
    expect(written.tasks.tasks).toContainEqual({
      label:          'ext: build (development)',
      type:           'shell',
      command:        'npx nx run ext:build:development',
      problemMatcher: [],
    })
    // What `mnci upgrade` does to this file: mnci-prefixed launch entries are
    // replaced, every other one and every task is carried through.
    const upgraded = JSON.parse(vscodeWorkspace('demo', written.tasks, written.launch)) as File
    expect(upgraded.launch.configurations).toContainEqual(debug)
    expect(upgraded.tasks.tasks).toEqual(written.tasks.tasks)
  })

  it('registers the build task without a start task', async () => {
    await runAdd('vscode-extension', 'ext', {})

    const scripts = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')).scripts
    expect(scripts['ext:build']).toBe('nx run ext:build')
    expect(scripts['ext:start']).toBeUndefined()
  })
})

describe('pinVscodeExtensionProjectNames', () => {
  it('pins nx.name on an extension that lacks it, and touches nothing else', () => {
    const write = (name: string, manifest: object): void => {
      mkdirSync(join(workspaceRoot, 'apps', name), { recursive: true })
      writeFileSync(join(workspaceRoot, 'apps', name, 'package.json'), JSON.stringify(manifest))
    }
    write('old', { name: 'old', nx: { tags: ['type:vscode-extension'] } })
    write('pinned', { name: 'renamed', nx: { name: 'pinned', tags: ['type:vscode-extension'] } })
    write('api', { name: 'api', nx: { tags: [] } })

    expect(pinVscodeExtensionProjectNames(workspaceRoot)).toEqual(['apps/old/package.json'])
    expect(manifest('old').nx).toEqual({ name: 'old', tags: ['type:vscode-extension'] })
    expect(manifest('pinned').nx.name).toBe('pinned')
    expect(manifest('api').nx.name).toBeUndefined()
    expect(pinVscodeExtensionProjectNames(workspaceRoot)).toEqual([])
  })
})

describe('refreshVscodeExtensionScript', () => {
  it('writes nothing in a workspace without an extension', () => {
    mkdirSync(join(workspaceRoot, 'apps/api'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/api/package.json'), JSON.stringify({ nx: { tags: [] } }))

    expect(refreshVscodeExtensionScript(workspaceRoot)).toBe(false)
    expect(existsSync(join(workspaceRoot, VSCODE_EXTENSION_SCRIPT_PATH))).toBe(false)
  })

  it('rewrites a stale script, and leaves a current one alone', () => {
    mkdirSync(join(workspaceRoot, 'apps/ext'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/ext/package.json'), JSON.stringify({ nx: { tags: ['type:vscode-extension'] } }))
    mkdirSync(join(workspaceRoot, 'tools'), { recursive: true })
    writeFileSync(join(workspaceRoot, VSCODE_EXTENSION_SCRIPT_PATH), '// an older version\n')

    expect(refreshVscodeExtensionScript(workspaceRoot)).toBe(true)
    expect(readFileSync(join(workspaceRoot, VSCODE_EXTENSION_SCRIPT_PATH), 'utf8')).toBe(VSCODE_EXTENSION_SCRIPT)
    expect(refreshVscodeExtensionScript(workspaceRoot)).toBe(false)
  })
})

/*
 * Fake `@vscode/vsce` and `nx` packages, resolved the way the script resolves the
 * real ones (their package.json `bin`). Each records its argv, working directory
 * and VERSION, and the fake vsce writes the --out file and lists bin/.
 */
function fakeTool (name: string, body: string): void {
  const root = join(workspaceRoot, 'node_modules', name)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, bin: { [name.split('/').pop()!]: 'cli.js' } }))
  writeFileSync(join(root, 'cli.js'), body)
}

function calls (): string[] {
  const path = join(workspaceRoot, 'calls.log')

  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : []
}

function runScript (arguments_: string[], env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [VSCODE_EXTENSION_SCRIPT_PATH, ...arguments_], {
    cwd:      workspaceRoot,
    encoding: 'utf8',
    env:      { ...process.env, VSCE_PAT: undefined, VSCE_AUTH: undefined, NX_DRY_RUN: undefined, ...env },
  })

  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('tools/vscode-extension.cjs, executed', () => {
  beforeEach(() => {
    mkdirSync(join(workspaceRoot, 'apps/ext'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/ext/package.json'), JSON.stringify({ name: 'ext', version: '1.4.0' }))
    mkdirSync(join(workspaceRoot, 'tools'), { recursive: true })
    writeFileSync(join(workspaceRoot, VSCODE_EXTENSION_SCRIPT_PATH), VSCODE_EXTENSION_SCRIPT)
    const record = `const fs=require('node:fs');const path=require('node:path');const root=${JSON.stringify(workspaceRoot)};`
    fakeTool('@vscode/vsce', record + String.raw`const a=process.argv.slice(2);const bin=fs.existsSync('bin')?fs.readdirSync('bin').join('+'):'-';fs.appendFileSync(path.join(root,'calls.log'),'vsce '+a.join(' ')+' | cwd='+path.relative(root,process.cwd())+' | bin='+bin+'\n');const o=a.indexOf('--out');if(o!==-1){fs.writeFileSync(a[o+1],'vsix')}`)
    fakeTool('nx', record + String.raw`fs.appendFileSync(path.join(root,'calls.log'),'nx '+process.argv.slice(2).join(' ')+' | VERSION='+process.env.VERSION+'\n');for(const p of ['windows-amd64','windows-arm64','linux-amd64','linux-arm64','darwin-amd64','darwin-arm64']){const d=path.join(root,'dist/platforms/engine',p);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'engine-'+p),'binary')}`)
  })

  it('packages one universal vsix from the project folder', () => {
    const result = runScript(['package', 'apps/ext'])

    expect(result.status).toBe(0)
    expect(calls()).toEqual([
      `vsce package --no-dependencies --skip-license --allow-missing-repository --out ${join(workspaceRoot, 'dist/drop/ext.vsix')} | cwd=${join('apps', 'ext')} | bin=-`,
    ])
    expect(existsSync(join(workspaceRoot, 'dist/drop/ext.vsix'))).toBe(true)
  })

  it('stamps the sidecar with the extension version and stages each platform in bin/', () => {
    const result = runScript(['package', 'apps/ext', '--sidecar', 'engine'])

    expect(result.status).toBe(0)
    const recorded = calls()
    expect(recorded[0]).toBe('nx run engine:build-all | VERSION=1.4.0')
    expect(recorded).toHaveLength(1 + Object.keys(VSCODE_SIDECAR_TARGETS).length)
    expect(recorded).toContain(
      `vsce package --target alpine-arm64 --no-dependencies --skip-license --allow-missing-repository --out ${join(workspaceRoot, 'dist/drop/ext-alpine-arm64.vsix')} | cwd=${join('apps', 'ext')} | bin=engine-linux-arm64`,
    )
    expect(recorded.find(call => call.includes('--target win32-x64'))).toContain('bin=engine-windows-amd64')
    // The staging folder never outlives the run, so it cannot be committed.
    expect(existsSync(join(workspaceRoot, 'apps/ext/bin'))).toBe(false)
  })

  it('names the packages after the project folder, not a renamed manifest (#247)', () => {
    writeFileSync(join(workspaceRoot, 'apps/ext/package.json'), JSON.stringify({ name: 'marketplace-id', version: '1.4.0' }))

    runScript(['package', 'apps/ext', '--sidecar', 'engine'])
    const result = runScript(['publish', 'apps/ext', '--sidecar', 'engine'], { VSCE_PAT: 'token' })

    expect(existsSync(join(workspaceRoot, 'dist/drop/ext-linux-x64.vsix'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'dist/drop/marketplace-id-linux-x64.vsix'))).toBe(false)
    expect(result.status).toBe(0)
  })

  it('fails, naming the platform, when build-all left one out', () => {
    fakeTool('nx', '')

    const result = runScript(['package', 'apps/ext', '--sidecar', 'engine'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('No windows-amd64 build of engine')
    expect(existsSync(join(workspaceRoot, 'apps/ext/bin'))).toBe(false)
  })

  it('skips the publish, naming both routes, with no Entra ID and VSCE_PAT unset or the literal Azure macro', () => {
    for (const env of [{}, { VSCE_PAT: '' }, { VSCE_PAT: '$(VSCE_PAT)' }, { VSCE_AUTH: '' }, { VSCE_AUTH: 'pat' }]) {
      const result = runScript(['publish', 'apps/ext'], env)

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No Marketplace credential - skipping the Marketplace publish of ext')
      expect(result.stdout).toContain('AZURE_CLIENT_ID and AZURE_TENANT_ID variables (Microsoft Entra ID) or the VSCE_PAT secret')
    }
    expect(calls()).toEqual([])
  })

  it('publishes with Microsoft Entra ID when the release step says so, with no token (#253)', () => {
    runScript(['package', 'apps/ext', '--sidecar', 'engine'])

    const result = runScript(['publish', 'apps/ext', '--sidecar', 'engine'], { VSCE_AUTH: 'entra' })

    expect(result.status).toBe(0)
    const publish = calls().find(call => call.startsWith('vsce publish'))!
    expect(publish).toMatch(/^vsce publish --azure-credential --packagePath /)
    expect(publish).toContain('--skip-duplicate')
    expect(publish.match(/\.vsix/g)).toHaveLength(8)
  })

  it('prefers Entra ID over a token when both are configured', () => {
    runScript(['package', 'apps/ext'])

    runScript(['publish', 'apps/ext'], { VSCE_AUTH: 'entra', VSCE_PAT: 'token' })

    expect(calls().find(call => call.startsWith('vsce publish'))).toContain('--azure-credential')
  })

  it('publishes with the token, and no --azure-credential, without Entra ID', () => {
    runScript(['package', 'apps/ext'])

    runScript(['publish', 'apps/ext'], { VSCE_PAT: 'token' })

    expect(calls().find(call => call.startsWith('vsce publish'))).not.toContain('--azure-credential')
  })

  it('publishes every packaged vsix in one call, tolerating a version already there', () => {
    runScript(['package', 'apps/ext', '--sidecar', 'engine'])

    const result = runScript(['publish', 'apps/ext', '--sidecar', 'engine'], { VSCE_PAT: 'token' })

    expect(result.status).toBe(0)
    const publish = calls().find(call => call.startsWith('vsce publish'))!
    expect(publish).toContain('--skip-duplicate')
    expect(publish.match(/\.vsix/g)).toHaveLength(8)
  })

  it('never publishes under nx release --dry-run, even with a token or Entra ID', () => {
    runScript(['package', 'apps/ext'])

    for (const [arguments_, env] of [
      [['publish', 'apps/ext', '--dryRun=true'], { VSCE_PAT: 'token' }],
      [['publish', 'apps/ext'], { VSCE_PAT: 'token', NX_DRY_RUN: 'true' }],
      [['publish', 'apps/ext', '--dryRun=true'], { VSCE_AUTH: 'entra' }],
      [['publish', 'apps/ext'], { VSCE_AUTH: 'entra', NX_DRY_RUN: 'true' }],
    ] as const) {
      const result = runScript([...arguments_], env)

      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`Dry run - would publish ${join(workspaceRoot, 'dist/drop/ext.vsix')}`)
    }
    expect(calls().some(call => call.startsWith('vsce publish'))).toBe(false)
  })

  it('refuses to publish what was never packaged', () => {
    const result = runScript(['publish', 'apps/ext'], { VSCE_PAT: 'token' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('run the package target first')
  })

  it('rejects an unknown command and a missing project', () => {
    expect(runScript(['ship', 'apps/ext']).stderr).toContain('Unknown command ship')
    expect(runScript(['package', 'apps/nothing']).stderr).toContain('Usage: node tools/vscode-extension.cjs')
  })
})
