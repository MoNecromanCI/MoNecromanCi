jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runFormatter: jest.fn(),
  runShell:     jest.fn(() => 0),
  // No git origin in these temp workspaces, so goModulePrefix (via registerNxGoPlugin)
  // resolves to undefined and the plugin registers under its bare name, as before.
  runCapture:   jest.fn(() => ({ status: 1, stdout: '' })),
}))
jest.mock('../terminal', () => ({
  ...jest.requireActual('../terminal'),
  promptText: jest.fn(),
}))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCapture, runNx, runShell } from '../nx-workspace'
import { runAdd } from './add-project.use-case'
import { addGoPlatformTargets, addGoSliceChecks, AIR_VERSION, GO_PLATFORMS, goLibraryIdentifiers, reshapeGoLibraryScaffold } from './go.use-case'

const mockRunNx = jest.mocked(runNx)
const mockRunShell = jest.mocked(runShell)
const mockRunCapture = jest.mocked(runCapture)

let workspaceRoot: string

/** Pre-creates the `project.json` the (mocked) plugin generator would write. */
function seedProjectJson (relativeDirectory: string, name: string): void {
  mkdirSync(join(workspaceRoot, relativeDirectory), { recursive: true })
  writeFileSync(
    join(workspaceRoot, relativeDirectory, 'project.json'),
    JSON.stringify({ name, projectType: 'application', targets: {} }),
  )
}

/** The plugins `nx.json` lists. */
function nxJsonPlugins (): unknown[] {
  return (JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as { plugins?: unknown[] }).plugins ?? []
}

/** The Vite config `@nx/react` writes, as far as the proxy edit cares. */
const VITE_CONFIG = "export default defineConfig(() => ({\n  server:   {\n    port: 4200,\n    host: 'localhost',\n  },\n}))\n"

/** Seeds a React app the way `mnci add react-app` leaves it, for the Go app that embeds it. */
function seedReactApp (directory = 'web', viteConfig = VITE_CONFIG): void {
  mkdirSync(join(workspaceRoot, 'apps', directory), { recursive: true })
  writeFileSync(join(workspaceRoot, 'apps', directory, 'package.json'), JSON.stringify({ name: `@demo/${directory}` }))
  writeFileSync(join(workspaceRoot, 'apps', directory, 'vite.config.mts'), viteConfig)
}

/** Reads a file of the generated `apps/site` back. */
function readSite (file: string): string {
  return readFileSync(join(workspaceRoot, 'apps/site', file), 'utf8')
}

/** Reads a generated project.json back. */
function readProjectJson (relativeDirectory: string): {
  targets: Record<
    string,
    { executor?: string; options?: Record<string, unknown>; parallelism?: boolean }
  >
} {
  return JSON.parse(
    readFileSync(join(workspaceRoot, relativeDirectory, 'project.json'), 'utf8'),
  ) as never
}

/** The argv of every `runNx` call, flattened for easy matching. */
function nxCalls (): string[][] {
  return mockRunNx.mock.calls.map(call => call[0])
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-go-'))
  mockRunShell.mockImplementation(() => 0)
  // Default: no git origin, so the module prefix is undefined (a test that wants one overrides).
  mockRunCapture.mockReturnValue({ status: 1, stdout: '' })
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(
    join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: '@demo/source', devDependencies: {} }),
  )
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('runAdd go', () => {
  it('probes for Go and fails fast with an install hint when it is missing', async () => {
    mockRunShell.mockImplementation(command => (command === 'go' ? 1 : 0))

    await expect(runAdd('go-app', 'api', {})).rejects.toThrow(/Go not found.*go\.dev/s)
  })

  it('replaces the generator\'s root Hello with a hello package behind main.go, importing it through the app module path', async () => {
    seedProjectJson('apps/api', 'api')
    // What the (mocked) generator writes: a module, and a Hello with its test in package main.
    writeFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'module api\n\ngo 1.24\n')
    writeFileSync(join(workspaceRoot, 'apps/api/main.go'), 'package main\n\nfunc Hello() string { return "x" }\n')
    writeFileSync(join(workspaceRoot, 'apps/api/main_test.go'), 'package main\n')

    await runAdd('go-app', 'api', {})

    const root = join(workspaceRoot, 'apps/api')
    expect(existsSync(join(root, 'main_test.go'))).toBe(false)
    expect(existsSync(join(root, 'hello/greet_use_case.go'))).toBe(true)
    expect(existsSync(join(root, 'hello/greeting_contract.go'))).toBe(true)
    expect(existsSync(join(root, 'hello/greet_use_case_test.go'))).toBe(true)
    const modulePath = /^module\s+(\S+)/m.exec(readFileSync(join(root, 'go.mod'), 'utf8'))?.[1] ?? ''
    expect(readFileSync(join(root, 'main.go'), 'utf8')).toContain(`"${modulePath}/hello"`)
  })

  it('gives a go-app a dev target that watches and restarts through a pinned air, and a root script for it (#230)', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    const targets = readProjectJson('apps/api').targets as Record<string, { continuous?: boolean, options?: { command: string, cwd: string } }>
    expect(targets.dev.continuous).toBe(true)
    expect(targets.dev.options?.command).toContain(`go run github.com/air-verse/air@${AIR_VERSION} `)
    expect(targets.dev.options?.cwd).toBe('apps/api')
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(manifest.scripts['api:dev']).toBe('nx run api:dev')
  })

  it('bootstraps a go.work workspace via init, without convert-to-one-mod, on the first add', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    expect(mockRunShell).toHaveBeenCalledWith('go', ['version'], workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith(
      'npm',
      ['install', '--save-dev', '@nx-go/nx-go', '--no-audit', '--no-fund'],
      workspaceRoot,
    )

    const calls = nxCalls()
    const initIndex = calls.findIndex(argv => argv.includes('@nx-go/nx-go:init'))
    const generateIndex = calls.findIndex(argv => argv.includes('@nx-go/nx-go:application'))
    expect(initIndex).toBeGreaterThanOrEqual(0)
    // Multi-module: init writes go.work, and convert-to-one-mod (which forced a single
    // root module) is never run; each generator writes its own go.mod after init.
    expect(calls.some(argv => argv.includes('@nx-go/nx-go:convert-to-one-mod'))).toBe(false)
    expect(generateIndex).toBeGreaterThan(initIndex)
  })

  it('skips the bootstrap when a root go.mod already exists (an adopted flat module)', async () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module demo\n\ngo 1.24\n')
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    expect(nxCalls().some(argv => argv.includes('@nx-go/nx-go:init'))).toBe(false)
  })

  it('skips the bootstrap when a go.work already exists (multi-module already set up)', async () => {
    writeFileSync(join(workspaceRoot, 'go.work'), 'go 1.24\n\nuse ./apps/other\n')
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    expect(nxCalls().some(argv => argv.includes('@nx-go/nx-go:init'))).toBe(false)
  })

  it('rewrites a generated project go.mod to the origin-derived module path (#289)', async () => {
    mockRunCapture.mockReturnValue({ status: 0, stdout: 'https://github.com/acme/demo.git\n' })
    seedProjectJson('apps/api', 'api')
    // The (mocked) plugin generator doesn't run, so stand in for the per-project go.mod it writes.
    writeFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'module apps/api\n\ngo 1.27\n')

    await runAdd('go-app', 'api', {})

    expect(readFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'utf8')).toContain('module github.com/acme/demo/apps/api')
  })

  it('leaves a generated go.mod alone when there is no git origin to derive a prefix from', async () => {
    seedProjectJson('apps/api', 'api')
    writeFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'module apps/api\n\ngo 1.27\n')

    await runAdd('go-app', 'api', {})

    expect(readFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'utf8')).toContain('module apps/api')
  })

  it('clamps a generated go directive to one the CI linter can load, and drops the toolchain line (#348)', async () => {
    seedProjectJson('apps/api', 'api')
    writeFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'module apps/api\n\ngo 1.27.0\n\ntoolchain go1.27.0\n')
    // The go.work the plugin's init writes, standing in for the generator that the mock does not run.
    mockRunNx.mockImplementation((argv: string[]) => {
      if (argv.includes('@nx-go/nx-go:init')) {
        writeFileSync(join(workspaceRoot, 'go.work'), 'go 1.27.0\n\ntoolchain go1.27.0\n\nuse ./apps/api\n')
      }
    })

    await runAdd('go-app', 'api', {})

    expect(readFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'utf8')).toBe('module apps/api\n\ngo 1.24\n\n')
    // The go.work mnci created is clamped once, here.
    expect(readFileSync(join(workspaceRoot, 'go.work'), 'utf8')).toBe('go 1.24\n\nuse ./apps/api\n')
  })

  it('never lowers a go.work the workspace already has, though a module in it needs a newer Go (#425)', async () => {
    // A module depends on a package that requires Go 1.26, so the workspace was raised to 1.27 by hand. Adding another
    // module reset it to 1.24, and every build failed until the line was fixed back.
    seedProjectJson('apps/desktop', 'desktop')
    writeFileSync(join(workspaceRoot, 'go.work'), 'go 1.27\n\nuse (\n\t./apps/tui\n)\n')
    writeFileSync(join(workspaceRoot, 'apps/desktop/go.mod'), 'module apps/desktop\n\ngo 1.27.0\n\ntoolchain go1.27.0\n')

    await runAdd('go-app', 'desktop', {})

    expect(readFileSync(join(workspaceRoot, 'go.work'), 'utf8')).toBe('go 1.27\n\nuse (\n\t./apps/tui\n)\n')
    // The new module is still held to the ceiling: a lower directive inside a higher workspace is valid.
    expect(readFileSync(join(workspaceRoot, 'apps/desktop/go.mod'), 'utf8')).toBe('module apps/desktop\n\ngo 1.24\n\n')
  })

  it('leaves a go directive at or below the ceiling alone (#348)', async () => {
    seedProjectJson('apps/api', 'api')
    writeFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'module apps/api\n\ngo 1.22\n')

    await runAdd('go-app', 'api', {})

    expect(readFileSync(join(workspaceRoot, 'apps/api/go.mod'), 'utf8')).toBe('module apps/api\n\ngo 1.22\n')
  })

  describe('onto a repository that already has its own go.mod (#261)', () => {
    const ADOPTED_GO_MOD = 'module youtube-downloader\n\ngo 1.24\n\nrequire github.com/charmbracelet/bubbletea v1.3.4\n'

    it('registers the Go plugin, which only the skipped bootstrap used to do, so Nx has a Go project graph', async () => {
      writeFileSync(join(workspaceRoot, 'go.mod'), ADOPTED_GO_MOD)
      writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ plugins: ['@nx/js/typescript'] }))
      seedProjectJson('apps/cli', 'cli')

      await runAdd('go-app', 'cli', {})

      expect(nxJsonPlugins()).toEqual(['@nx/js/typescript', '@nx-go/nx-go'])
    })

    it('leaves the module path and its requirements alone, and creates no go.work', async () => {
      writeFileSync(join(workspaceRoot, 'go.mod'), ADOPTED_GO_MOD)
      seedProjectJson('apps/cli', 'cli')

      await runAdd('go-app', 'cli', {})

      expect(readFileSync(join(workspaceRoot, 'go.mod'), 'utf8')).toBe(ADOPTED_GO_MOD)
      expect(existsSync(join(workspaceRoot, 'go.work'))).toBe(false)
      // Not run, rather than run and undone: init writes the go.work this layout rejects.
      expect(nxCalls().some(argv => argv.includes('@nx-go/nx-go:init'))).toBe(false)
    })

    it('registers it once however many Go projects are added', async () => {
      writeFileSync(join(workspaceRoot, 'go.mod'), ADOPTED_GO_MOD)
      seedProjectJson('apps/cli', 'cli')
      seedProjectJson('libs/core', 'core')

      await runAdd('go-app', 'cli', {})
      await runAdd('go-internal-lib', 'core', {})

      expect(nxJsonPlugins().filter(entry => entry === '@nx-go/nx-go')).toHaveLength(1)
    })

    it('says what it did, so the nx.json change is not a surprise', async () => {
      writeFileSync(join(workspaceRoot, 'go.mod'), ADOPTED_GO_MOD)
      seedProjectJson('apps/cli', 'cli')

      await runAdd('go-app', 'cli', {})

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Registering the Go plugin in nx.json'))
    })
  })

  it('adds a Go app under apps/ with build, test, lint and package targets', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    expect(mockRunNx).toHaveBeenCalledWith(
      [
        'g',
        '@nx-go/nx-go:application',
        'apps/api',
        '--name=api',
        '--tags=type:go-app',
        '--no-interactive',
      ],
      workspaceRoot,
    )

    const { targets } = readProjectJson('apps/api')
    expect(targets.build.executor).toBe('@nx-go/nx-go:build')
    expect(targets.test.executor).toBe('@nx-go/nx-go:test')
    expect(targets.package.executor).toBe('nx:run-commands')
    // Basename is exactly `go-app-<name>` — CI turns it into the build tag.
    expect(JSON.stringify(targets.package)).toContain('dist/drop/go-app-api.zip')
  })

  it('keeps a Go app out of nx release unless --release is given (#259)', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'apps/api/project.json'), 'utf8')) as { tags?: string[]; release?: unknown }
    expect(project.tags ?? []).not.toContain('release:go')
    expect(project.release).toBeUndefined()
    expect(existsSync(join(workspaceRoot, 'tools/go-app-release.cjs'))).toBe(false)
  })

  it('makes the app releasable with --release: tag, manifest-less version config and the script (#259)', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', { release: true })

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'apps/api/project.json'), 'utf8')) as {
      tags:    string[]
      release: { version: Record<string, unknown> }
    }
    expect(project.tags).toContain('release:go')
    expect(project.release.version).toEqual({ versionActions: 'tools/go-app-release.cjs', currentVersionResolver: 'git-tag' })
    expect(existsSync(join(workspaceRoot, 'tools/go-app-release.cjs'))).toBe(true)
    // The build, package and start targets are unchanged by opting in.
    expect(readProjectJson('apps/api').targets['package-all'].executor).toBe('nx:run-commands')
  })

  it('rejects --release for a kind that cannot be released, before anything is generated (#259)', async () => {
    await expect(runAdd('go-lib', 'core', { release: true })).rejects.toThrow('--release applies to go-app only, not go-lib.')

    expect(mockRunNx).not.toHaveBeenCalled()
  })

  describe('an app that embeds and serves a React app (#262)', () => {
    type Targets = Record<string, { dependsOn?: unknown[]; inputs?: unknown[]; outputs?: string[]; options?: { command?: string; commands?: string[]; parallel?: boolean } }>
    const projectOf = (directory: string): { implicitDependencies?: string[]; targets: Targets } =>
      JSON.parse(readFileSync(join(workspaceRoot, 'apps', directory, 'project.json'), 'utf8')) as never

    it('stages the React build into the app, after building it, with its output declared so Nx caches it', async () => {
      seedReactApp()
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      const stage = projectOf('site').targets['stage-web']
      // The real Nx name, scope included, not the directory: dependsOn matches on it.
      expect(stage.dependsOn).toEqual([{ projects: ['@demo/web'], target: 'build' }])
      expect(stage.outputs).toEqual(['{workspaceRoot}/apps/site/webui/web'])
      expect(stage.inputs).toEqual([{ dependentTasksOutputFiles: '**/*' }])
      expect(stage.options?.command).toContain("fs.cpSync('apps/web/dist','apps/site/webui/web'")
    })

    it('makes every target that compiles Go wait for it, so a fresh clone is green', async () => {
      seedReactApp()
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      const { targets } = projectOf('site')
      for (const target of ['build', 'test', 'lint', 'start', 'build-all']) {
        expect(targets[target].dependsOn).toContain('stage-web')
      }
      // Reached through the target they already depend on.
      expect(targets.package.dependsOn).toEqual(['build'])
      expect(targets['package-all'].dependsOn).toEqual(['build-all'])
    })

    it('puts the React app in the project graph, so a change to it marks the Go app affected', async () => {
      seedReactApp()
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      expect(projectOf('site').implicitDependencies).toEqual(['@demo/web'])
      expect(projectOf('site').targets['stage-web'].dependsOn).not.toContainEqual('stage-web')
    })

    it('adds a dev target that runs the Vite server and the Go server together', async () => {
      seedReactApp()
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      expect(projectOf('site').targets.dev.options).toEqual({ commands: ['nx run @demo/web:serve', 'nx run site:start'], parallel: true })
    })

    it('writes a server that embeds the staged files, and git-ignores them', async () => {
      seedReactApp()
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      expect(readSite('.gitignore')).toBe('/webui/web/\n')
      expect(readSite('webui/web_handler.go')).toContain('package webui')
      expect(readSite('webui/web_handler.go')).toContain('//go:embed all:web')
      expect(readSite('webui/web_handler.go')).toContain('\tfiles := http.FileServer(http.FS(root))')
      expect(readSite('main.go')).toContain('mux.Handle("/", webui.Handler())')
      expect(readSite('main.go')).toMatch(/"[^"]+\/webui"/)
      // The stamp build-all writes has something to land on, and something reads it.
      expect(readSite('main.go')).toContain('var version = "dev"')
      expect(readSite('webui/web_handler_test.go')).toContain('TestWebHandlerServesTheBuiltFrontend')
      // The root holds only main.go, which is what the Go slice check requires.
      expect(existsSync(join(workspaceRoot, 'apps/site/web.go'))).toBe(false)
    })

    it('proxies /api to the Go server from the Vite dev server', async () => {
      seedReactApp()
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      const config = readFileSync(join(workspaceRoot, 'apps/web/vite.config.mts'), 'utf8')
      expect(config).toContain("proxy: { '/api': 'http://127.0.0.1:8080' },")
      expect(config.indexOf('proxy')).toBeGreaterThan(config.indexOf('server:'))
      expect(config.indexOf('proxy')).toBeLessThan(config.indexOf('port: 4200'))
    })

    it('leaves a Vite config that already has an /api proxy alone', async () => {
      const own = "export default { server: { proxy: { '/api': 'http://localhost:9000' } } }\n"
      seedReactApp('web', own)
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      expect(readFileSync(join(workspaceRoot, 'apps/web/vite.config.mts'), 'utf8')).toBe(own)
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Could not add the /api proxy'))
    })

    it('says what to add when the Vite config has no server block to put the proxy in', async () => {
      seedReactApp('web', 'export default {}\n')
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web' })

      expect(readFileSync(join(workspaceRoot, 'apps/web/vite.config.mts'), 'utf8')).toBe('export default {}\n')
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("proxy: { '/api': 'http://127.0.0.1:8080' }"))
    })

    it('names the missing React app and stops before anything is generated or installed', async () => {
      await expect(runAdd('go-app', 'site', { web: 'ui' })).rejects.toThrow('--web ui: no React app at apps/ui. Add it first with `mnci add react-app ui`.')

      expect(mockRunNx).not.toHaveBeenCalled()
      expect(mockRunShell).not.toHaveBeenCalled()
    })

    it('does not take a directory that is not a React app for one', async () => {
      mkdirSync(join(workspaceRoot, 'apps/plain'), { recursive: true })
      writeFileSync(join(workspaceRoot, 'apps/plain/package.json'), JSON.stringify({ name: '@demo/plain' }))

      await expect(runAdd('go-app', 'site', { web: 'plain' })).rejects.toThrow('no React app at apps/plain')
    })

    it('is rejected for a kind that cannot embed a frontend, before anything is generated', async () => {
      await expect(runAdd('go-lib', 'core', { web: 'web' })).rejects.toThrow('--web applies to go-app only, not go-lib.')

      expect(mockRunNx).not.toHaveBeenCalled()
    })

    it('combines with --cgo: the native build waits for the frontend too', async () => {
      seedReactApp()
      seedProjectJson('apps/site', 'site')

      await runAdd('go-app', 'site', { web: 'web', cgo: true })

      expect(projectOf('site').targets['build-native'].dependsOn).toContain('stage-web')
      expect(projectOf('site').targets['package-native'].dependsOn).toEqual(['build-native'])
    })
  })

  describe('a native (cgo) app (#263)', () => {
    it('is tagged build:cgo, and builds and packages for the host only', async () => {
      seedProjectJson('apps/tray', 'tray')

      await runAdd('go-app', 'tray', { cgo: true })

      expect(nxCalls().find(argv => argv.includes('@nx-go/nx-go:application'))).toContain('--tags=type:go-app,build:cgo')
      const targets = readProjectJson('apps/tray').targets as Record<string, Record<string, unknown>>
      const command = (targets['build-native'].options as { command: string }).command
      expect(command).toContain("CGO_ENABLED:'1'")
      expect(command).toContain("'-s -w -X main.version='+v")
      expect(command).toContain("host('GOOS')")
      expect(targets['build-native'].outputs).toEqual(['{workspaceRoot}/dist/platforms/tray'])
      expect(targets['build-native'].inputs).toContain('{workspaceRoot}/go.sum')
      expect(targets['package-native'].dependsOn).toEqual(['build-native'])
      expect(targets['package-native'].outputs).toEqual(['{workspaceRoot}/dist/drop/go-app-tray-*.zip'])
    })

    it('has no cross-compile and no package target, which the single-agent steps would run', async () => {
      seedProjectJson('apps/tray', 'tray')

      await runAdd('go-app', 'tray', { cgo: true })

      const targets = Object.keys(readProjectJson('apps/tray').targets)
      expect(targets).toEqual(expect.arrayContaining(['build', 'test', 'lint', 'start']))
      expect(targets).not.toContain('package')
      expect(targets).not.toContain('build-all')
      expect(targets).not.toContain('package-all')
    })

    it('tells the user the pipeline needs an upgrade, and what to add for Linux', async () => {
      seedProjectJson('apps/tray', 'tray')

      await runAdd('go-app', 'tray', { cgo: true })

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('mnci upgrade'))
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('-dev packages'))
    })

    it('can be released as well: the zips of the native legs go to the same release', async () => {
      seedProjectJson('apps/tray', 'tray')

      await runAdd('go-app', 'tray', { cgo: true, release: true })

      const project = JSON.parse(readFileSync(join(workspaceRoot, 'apps/tray/project.json'), 'utf8')) as { tags?: string[] }
      expect(project.tags).toContain('release:go')
    })

    it('is rejected for a kind that cannot be built natively, before anything is generated', async () => {
      await expect(runAdd('go-lib', 'core', { cgo: true })).rejects.toThrow('--cgo applies to go-app only, not go-lib.')

      expect(mockRunNx).not.toHaveBeenCalled()
    })

    it('is left alone by the upgrade that adds the cross-compile targets to older apps', () => {
      seedProjectJson('apps/tray', 'tray')
      writeFileSync(
        join(workspaceRoot, 'apps/tray/project.json'),
        JSON.stringify({ name: 'tray', tags: ['type:go-app', 'build:cgo'], targets: {} }),
      )
      seedProjectJson('apps/plain', 'plain')
      writeFileSync(join(workspaceRoot, 'apps/plain/project.json'), JSON.stringify({ name: 'plain', tags: ['type:go-app'], targets: {} }))

      expect(addGoPlatformTargets(workspaceRoot)).toEqual(['apps/plain/project.json', 'apps/tray/project.json'])
      expect(Object.keys(readProjectJson('apps/tray').targets as object)).toEqual(['build-dev', 'dev'])
    })
  })

  it('cross-compiles for six platforms into dist/platforms, outside the cached build output', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    const targets = readProjectJson('apps/api').targets as Record<string, Record<string, unknown>>
    const buildAll = targets['build-all']
    const command = (buildAll.options as { command: string }).command
    expect(buildAll.executor).toBe('nx:run-commands')
    expect(buildAll.outputs).toEqual(['{workspaceRoot}/dist/platforms/api'])
    expect(buildAll.inputs).toEqual(['default', '^default', '{workspaceRoot}/go.mod', '{workspaceRoot}/go.sum', { env: 'VERSION' }])
    for (const platform of GO_PLATFORMS) {
      expect(command).toContain(`'${platform}'`)
    }
    expect(command).toContain("CGO_ENABLED:'0'")
    expect(command).toContain("'-s -w -X main.version='+v")
    expect(command).toContain("cwd:'apps/api'")
    expect(targets['package-all']).toMatchObject({
      dependsOn: ['build-all'],
      outputs:   ['{workspaceRoot}/dist/drop/go-app-api-*.zip'],
    })
  })

  it('wires a local `go run .` start target and the discoverable root scripts', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    const { targets } = readProjectJson('apps/api')
    expect(targets.start).toMatchObject({
      executor:   'nx:run-commands',
      continuous: true,
      options:    { command: 'go run .', cwd: 'apps/api' },
    })

    const rootManifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(rootManifest.scripts['api:build']).toBe('nx run api:build')
    expect(rootManifest.scripts['api:qa']).toBe('nx run api:lint && nx run api:test')
    expect(rootManifest.scripts['api:start']).toBe('nx run api:start')
  })

  it('builds into a dist DIRECTORY, not a bare file, so Nx can cache the output', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    // Regression guard: the executor's default writes the binary as a bare
    // file at dist/apps/<name>. Declaring a file in `outputs` makes Nx's
    // output collection fail with ENOTDIR, which surfaced only once caching
    // was left on — so the binary goes one level deeper, inside a directory.
    const { targets } = readProjectJson('apps/api')
    expect(targets.build.options).toEqual({ outputPath: '../../dist/apps/api/api' })
    expect(JSON.stringify(targets.package)).toContain("addLocalFolder('dist/apps/api')")
  })

  it('pins the lint target to golangci-lint, not the executor default of `go fmt`', async () => {
    seedProjectJson('apps/api', 'api')

    await runAdd('go-app', 'api', {})

    const { targets } = readProjectJson('apps/api')
    expect(targets.lint.executor).toBe('@nx-go/nx-go:lint')
    expect(targets.lint.options).toEqual({ linter: 'golangci-lint', args: ['run'] })
  })

  it('serialises the lint target, because golangci-lint refuses to run beside itself', async () => {
    // A correctness fix, not tuning. `golangci-lint` takes a machine-global lock
    // and exits non-zero with `parallel golangci-lint is running` when a second
    // copy starts. Nx runs `lint` across projects concurrently, so a workspace
    // with two or more Go projects failed `nx run-many -t lint` at random — one
    // project printing `0 issues` while a sibling died on the lock, and the
    // victim moving between runs.
    //
    // Found the first time CI ever ran the Go lint assertion: golangci-lint had
    // never been installed on the runner, so the check reported SKIPPED and this
    // shipped unnoticed. Only `lint` is serialised; build and test still run in
    // parallel.
    seedProjectJson('apps/api', 'api')
    seedProjectJson('apps/fn', 'fn')

    await runAdd('go-app', 'api', {})
    await runAdd('go-function-app', 'fn', {})

    expect(readProjectJson('apps/api').targets.lint.parallelism).toBe(false)
    expect(readProjectJson('apps/fn').targets.lint.parallelism).toBe(false)
    // ...and nothing else was serialised as collateral.
    expect(readProjectJson('apps/api').targets.build.parallelism).toBeUndefined()
    expect(readProjectJson('apps/api').targets.test.parallelism).toBeUndefined()
  })

  it('warns but does not fail when golangci-lint is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockRunShell.mockImplementation(command => (command === 'golangci-lint' ? 1 : 0))
    seedProjectJson('apps/api', 'api')

    await expect(runAdd('go-app', 'api', {})).resolves.not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('golangci-lint not found'))
  })

  it('adds a Go function app tagged separately, with its own drop basename', async () => {
    seedProjectJson('apps/handler', 'handler')

    await runAdd('go-function-app', 'handler', {})

    expect(mockRunNx).toHaveBeenCalledWith(
      expect.arrayContaining(['@nx-go/nx-go:application', '--tags=type:go-function-app']),
      workspaceRoot,
    )
    const { targets } = readProjectJson('apps/handler')
    expect(JSON.stringify(targets.package)).toContain('dist/drop/go-function-app-handler.zip')

    // No `start` target: there is no Azure Functions custom-handler wiring
    // for Go yet, so `func start` would just fail — a known gap, not a script.
    expect(targets.start).toBeUndefined()
    const rootManifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(rootManifest.scripts['handler:build']).toBe('nx run handler:build')
    expect(rootManifest.scripts['handler:start']).toBeUndefined()
  })

  it('packages a Go function app per platform under its own drop basename', async () => {
    seedProjectJson('apps/handler', 'handler')

    await runAdd('go-function-app', 'handler', {})

    const targets = readProjectJson('apps/handler').targets as Record<string, Record<string, unknown>>
    expect(targets['build-all']).toBeDefined()
    expect(targets['package-all'].outputs).toEqual(['{workspaceRoot}/dist/drop/go-function-app-handler-*.zip'])
  })

  it('adds a publishable Go lib under packages/ with test and lint but no build or publish target', async () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module demo\n\ngo 1.24\n')
    seedProjectJson('packages/core', 'core')

    await runAdd('go-lib', 'core', {})

    expect(mockRunNx).toHaveBeenCalledWith(
      [
        'g',
        '@nx-go/nx-go:library',
        'packages/core',
        '--name=core',
        '--tags=type:go-lib',
        '--no-interactive',
      ],
      workspaceRoot,
    )

    const { targets } = readProjectJson('packages/core')
    expect(Object.keys(targets).toSorted((a, b) => a.localeCompare(b))).toEqual(['lint', 'slice-check', 'test'])
    // Go publishing is a git tag, not a registry upload — there is nothing to push.
    expect(targets['nx-release-publish']).toBeUndefined()
  })

  it('adds an internal Go lib under libs/', async () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module demo\n\ngo 1.24\n')
    seedProjectJson('libs/util', 'util')

    await runAdd('go-internal-lib', 'util', {})

    expect(mockRunNx).toHaveBeenCalledWith(
      [
        'g',
        '@nx-go/nx-go:library',
        'libs/util',
        '--name=util',
        '--tags=type:go-internal-lib',
        '--no-interactive',
      ],
      workspaceRoot,
    )
    expect(
      Object.keys(readProjectJson('libs/util').targets).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['lint', 'slice-check', 'test'])
  })

  it('honours MNCI_NX_GO_SPEC so e2e can redirect the plugin install', async () => {
    process.env.MNCI_NX_GO_SPEC = '/tmp/nx-go.tgz'
    seedProjectJson('apps/api', 'api')

    try {
      await runAdd('go-app', 'api', {})
      expect(mockRunShell).toHaveBeenCalledWith(
        ['npm', 'install', '--save-dev', '/tmp/nx-go.tgz', '--no-audit', '--no-fund'][0],
        ['install', '--save-dev', '/tmp/nx-go.tgz', '--no-audit', '--no-fund'],
        workspaceRoot,
      )
    } finally {
      delete process.env.MNCI_NX_GO_SPEC
    }
  })
  it('reshapes a Go lib into a capability: only doc.go at the root, the sample code in one slice package', async () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module demo\n\ngo 1.24\n')
    seedProjectJson('libs/markdown-workspace', 'markdown-workspace')
    // What `@nx-go/nx-go:library` writes at the root (the generator is mocked here).
    writeFileSync(join(workspaceRoot, 'libs/markdown-workspace/markdown-workspace.go'), 'package markdownworkspace\n')
    writeFileSync(join(workspaceRoot, 'libs/markdown-workspace/markdown-workspace_test.go'), 'package markdownworkspace\n')

    await runAdd('go-internal-lib', 'markdown-workspace', {})

    const root = join(workspaceRoot, 'libs/markdown-workspace')
    expect(readdirSync(root).toSorted((a, b) => a.localeCompare(b))).toEqual(['doc.go', 'markdownworkspace', 'project.json'])
    expect(readFileSync(join(root, 'doc.go'), 'utf8')).toMatch(/^package markdownworkspace$/m)
    expect(readdirSync(join(root, 'markdownworkspace')).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'doc.go',
      'greeting_contract.go',
      'markdown_workspace_use_case_test.go',
      'markdown_workspace_use_case.go',
    ])
    const useCase = readFileSync(join(root, 'markdownworkspace/markdown_workspace_use_case.go'), 'utf8')
    expect(useCase).toMatch(/^package markdownworkspace$/m)
    expect(useCase).toContain('func Greet(name string) Greeting {')
    expect(readFileSync(join(root, 'markdownworkspace/greeting_contract.go'), 'utf8')).toContain('type Greeting struct {')
    expect(readFileSync(join(root, 'markdownworkspace/markdown_workspace_use_case_test.go'), 'utf8')).toContain(
      'func TestGreet(t *testing.T) {',
    )
  })

  it('reshapes a publishable Go lib the same way', async () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module demo\n\ngo 1.24\n')
    seedProjectJson('packages/core', 'core')

    await runAdd('go-lib', 'core', {})

    expect(existsSync(join(workspaceRoot, 'packages/core/doc.go'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'packages/core/core/core_use_case.go'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'packages/core/core.go'))).toBe(false)
  })

  it('leaves Go test and lint targets without a package list, because the executors already recurse with ./...', async () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module demo\n\ngo 1.24\n')
    seedProjectJson('libs/util', 'util')

    await runAdd('go-internal-lib', 'util', {})

    // @nx-go/nx-go 4.1.1 appends `./...` itself and runs from the project root
    // (MoNecromanCI/MoNecromanCi#233), so the slice packages below the root are
    // tested and linted. Passing a package list here would override that.
    const { targets } = readProjectJson('libs/util')
    expect(targets.test).toEqual({ executor: '@nx-go/nx-go:test' })
    expect(targets.lint?.options).toEqual({ linter: 'golangci-lint', args: ['run'] })
  })
})

describe('reshapeGoLibraryScaffold', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'mnci-go-lib-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('is idempotent and never overwrites a slice file the user already edited', () => {
    reshapeGoLibraryScaffold(projectRoot, 'util')
    const edited = join(projectRoot, 'util/util_use_case.go')
    writeFileSync(edited, 'package util\n\n// edited\n')

    expect(reshapeGoLibraryScaffold(projectRoot, 'util')).toBe('util')
    expect(readFileSync(edited, 'utf8')).toBe('package util\n\n// edited\n')
  })

  it.each([
    ['util', { packageName: 'util', functionName: 'Util', fileStem: 'util' }],
    ['markdown-workspace', { packageName: 'markdownworkspace', functionName: 'MarkdownWorkspace', fileStem: 'markdown_workspace' }],
    ['lore-master-engine2', { packageName: 'loremasterengine2', functionName: 'LoreMasterEngine2', fileStem: 'lore_master_engine2' }],
    // The plugin itself leaves a dotted name as an invalid package clause.
    ['my.lib', { packageName: 'mylib', functionName: 'MyLib', fileStem: 'my_lib' }],
  ])('derives Go identifiers for %s', (name, expected) => {
    expect(goLibraryIdentifiers(name)).toEqual(expected)
  })
})

describe('addGoPlatformTargets', () => {
  let root: string

  /** Writes apps/<name>/project.json with these tags and targets. */
  function app (name: string, tags: string[], targets: Record<string, unknown>): void {
    mkdirSync(join(root, 'apps', name), { recursive: true })
    writeFileSync(join(root, 'apps', name, 'project.json'), JSON.stringify({ name, tags, targets }))
  }

  function targetsOf (name: string): Record<string, unknown> {
    return (JSON.parse(readFileSync(join(root, 'apps', name, 'project.json'), 'utf8')) as { targets: Record<string, unknown> }).targets
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-go-platforms-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('gives Go apps added before cross-compilation the targets, and nothing else', () => {
    app('engine', ['type:go-app'], { build: { executor: '@nx-go/nx-go:build' } })
    app('handler', ['type:go-function-app'], { 'build-all': { command: 'my own' } })
    app('web', ['type:react-app'], {})
    mkdirSync(join(root, 'apps', 'notes'))

    expect(addGoPlatformTargets(root)).toEqual(['apps/engine/project.json', 'apps/handler/project.json'])

    const engine = targetsOf('engine')
    expect(Object.keys(engine).sort((a, b) => a.localeCompare(b))).toEqual(['build', 'build-all', 'build-dev', 'dev', 'package-all'])
    expect(JSON.stringify(engine['build-dev'])).toContain('-gcflags=all=-N -l')
    expect(JSON.stringify(engine['package-all'])).toContain('go-app-engine-*.zip')
    const handler = targetsOf('handler')
    expect(handler['build-all']).toEqual({ command: 'my own' })
    expect(JSON.stringify(handler['package-all'])).toContain('go-function-app-handler-*.zip')
    expect(targetsOf('web')).toEqual({})

    expect(addGoPlatformTargets(root)).toEqual([])
  })

  it('adds build-dev to a go-app (cgo included) without overwriting one, and not to a function app', () => {
    app('native', ['type:go-app', 'build:cgo'], {})
    app('mine', ['type:go-app'], { 'build-all': {}, 'package-all': {}, 'build-dev': { command: 'my own' }, 'dev': { command: 'my watcher' } })
    app('fn', ['type:go-function-app'], { 'build-all': {}, 'package-all': {} })

    expect(addGoPlatformTargets(root)).toEqual(['apps/native/project.json'])
    expect(Object.keys(targetsOf('native'))).toEqual(['build-dev', 'dev'])
    expect(JSON.stringify(targetsOf('native').dev)).toContain('air-verse/air@')
    expect(targetsOf('mine')['build-dev']).toEqual({ command: 'my own' })
    expect(targetsOf('mine').dev).toEqual({ command: 'my watcher' })
    expect(targetsOf('fn')['build-dev']).toBeUndefined()
  })

  it('does nothing in a workspace without apps/', () => {
    expect(addGoPlatformTargets(root)).toEqual([])
  })
})

describe('addGoSliceChecks (#232)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-goslice-upgrade-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Writes a project.json under `parent/name`. */
  function project (parent: string, name: string, tags: string[], targets: Record<string, unknown>): void {
    mkdirSync(join(root, parent, name), { recursive: true })
    writeFileSync(join(root, parent, name, 'project.json'), JSON.stringify({ name, tags, targets }))
  }

  const targetsOf = (path: string): Record<string, { dependsOn?: string[] }> => (JSON.parse(readFileSync(join(root, path, 'project.json'), 'utf8')) as { targets: Record<string, { dependsOn?: string[] }> }).targets

  it('adds slice-check to every Go project and makes lint depend on it, keeping what lint already has', () => {
    project('apps', 'api', ['type:go-app'], { lint: { executor: 'x', dependsOn: ['build'] } })
    project('libs', 'core', ['type:go-internal-lib'], { lint: { executor: 'x' } })
    project('apps', 'web', ['type:react-app'], { lint: { executor: 'y' } })

    expect(addGoSliceChecks(root)).toEqual(['apps/api/project.json', 'libs/core/project.json', 'tools/go-slice-check.cjs'])
    expect(targetsOf('apps/api').lint.dependsOn).toEqual(['build', 'slice-check'])
    expect(targetsOf('libs/core').lint.dependsOn).toEqual(['slice-check'])
    expect(JSON.stringify(targetsOf('apps/api')['slice-check'])).toContain('node tools/go-slice-check.cjs apps/api')
    expect(targetsOf('apps/web')['slice-check']).toBeUndefined()
  })

  it('is a no-op the second time, and writes nothing for a workspace with no Go project', () => {
    project('apps', 'api', ['type:go-app'], { lint: { executor: 'x' } })
    addGoSliceChecks(root)

    expect(addGoSliceChecks(root)).toEqual([])

    const empty = mkdtempSync(join(tmpdir(), 'mnci-goslice-empty-'))
    try {
      expect(addGoSliceChecks(empty)).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('keeps a slice-check target the team wrote', () => {
    project('apps', 'api', ['type:go-app'], { 'lint': { executor: 'x', dependsOn: ['slice-check'] }, 'slice-check': { command: 'mine' } })

    expect(addGoSliceChecks(root)).toEqual(['tools/go-slice-check.cjs'])
    expect(targetsOf('apps/api')['slice-check']).toEqual({ command: 'mine' })
  })
})
