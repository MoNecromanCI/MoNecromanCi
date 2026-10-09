import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GO_RELEASE_SCRIPT,
  GO_RELEASE_SCRIPT_PATH,
  makeGoAppReleasable,
  refreshGoReleaseScript,
} from './go-release.use-case'

let workspaceRoot: string

/** Writes a Go app's `project.json`, as `@nx-go/nx-go:application` and `addGoApp` leave it. */
function goApp (name: string, extra: Record<string, unknown> = {}): void {
  mkdirSync(join(workspaceRoot, 'apps', name), { recursive: true })
  writeFileSync(
    join(workspaceRoot, 'apps', name, 'project.json'),
    JSON.stringify({ name, tags: ['type:go-app'], targets: { build: { executor: 'x' } }, ...extra }),
  )
}

/** Reads a Go app's `project.json` back. */
function project (name: string): { tags: string[]; targets: unknown; release?: { version: Record<string, unknown> } } {
  return JSON.parse(readFileSync(join(workspaceRoot, 'apps', name, 'project.json'), 'utf8')) as ReturnType<typeof project>
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-go-release-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('makeGoAppReleasable', () => {
  it('tags the app and points Nx at the manifest-less version actions, resolving versions from git tags', () => {
    goApp('tool')

    makeGoAppReleasable(workspaceRoot, 'tool')

    expect(project('tool').tags).toEqual(['type:go-app', 'release:go'])
    expect(project('tool').release?.version).toEqual({
      versionActions:         'tools/go-app-release.cjs',
      currentVersionResolver: 'git-tag',
    })
  })

  it('writes the script into the workspace', () => {
    goApp('tool')

    makeGoAppReleasable(workspaceRoot, 'tool')

    expect(readFileSync(join(workspaceRoot, GO_RELEASE_SCRIPT_PATH), 'utf8')).toBe(GO_RELEASE_SCRIPT)
  })

  it('adds a publish target that publishes nothing, so the publish phase cannot abort after tagging', () => {
    goApp('tool')

    makeGoAppReleasable(workspaceRoot, 'tool')

    // Measured: with no `nx-release-publish` target, `nx release` tagged and then exited 1.
    const targets = project('tool').targets as Record<string, { executor: string; options: { command: string } }>
    expect(targets.build).toEqual({ executor: 'x' })
    expect(targets['nx-release-publish'].executor).toBe('nx:run-commands')
    expect(targets['nx-release-publish'].options.command).toContain('Published by its git tag')
  })

  it('keeps a publish target the app already had', () => {
    goApp('tool', { targets: { 'nx-release-publish': { executor: 'mine' } } })

    makeGoAppReleasable(workspaceRoot, 'tool')

    expect(project('tool').targets).toEqual({ 'nx-release-publish': { executor: 'mine' } })
  })

  it('is safe to run twice, and keeps release config the user already had', () => {
    goApp('tool', { release: { version: { preserveLocalDependencyProtocols: true } } })

    makeGoAppReleasable(workspaceRoot, 'tool')
    makeGoAppReleasable(workspaceRoot, 'tool')

    expect(project('tool').tags).toEqual(['type:go-app', 'release:go'])
    expect(project('tool').release?.version).toEqual({
      preserveLocalDependencyProtocols: true,
      versionActions:                   'tools/go-app-release.cjs',
      currentVersionResolver:           'git-tag',
    })
  })

  it('names the missing app instead of writing a script for nothing', () => {
    expect(() => makeGoAppReleasable(workspaceRoot, 'nope')).toThrow('No Go app at apps/nope')
    expect(existsSync(join(workspaceRoot, GO_RELEASE_SCRIPT_PATH))).toBe(false)
  })
})

describe('refreshGoReleaseScript', () => {
  it('does nothing, and writes no file, when no app is releasable', () => {
    goApp('tool')

    expect(refreshGoReleaseScript(workspaceRoot)).toBe(false)
    expect(existsSync(join(workspaceRoot, GO_RELEASE_SCRIPT_PATH))).toBe(false)
  })

  it('does nothing in a workspace with no apps folder', () => {
    expect(refreshGoReleaseScript(workspaceRoot)).toBe(false)
  })

  it('rewrites a stale script, and leaves an up-to-date one alone', () => {
    goApp('tool', { tags: ['type:go-app', 'release:go'] })
    mkdirSync(join(workspaceRoot, 'tools'), { recursive: true })
    writeFileSync(join(workspaceRoot, GO_RELEASE_SCRIPT_PATH), '// old')

    expect(refreshGoReleaseScript(workspaceRoot)).toBe(true)
    expect(readFileSync(join(workspaceRoot, GO_RELEASE_SCRIPT_PATH), 'utf8')).toBe(GO_RELEASE_SCRIPT)
    expect(refreshGoReleaseScript(workspaceRoot)).toBe(false)
  })

  it('creates the script for an app that was made releasable before the script existed', () => {
    goApp('tool', { tags: ['type:go-app', 'release:go'] })

    expect(refreshGoReleaseScript(workspaceRoot)).toBe(true)
    expect(existsSync(join(workspaceRoot, GO_RELEASE_SCRIPT_PATH))).toBe(true)
  })
})

/** The script as a class Nx would load, written to disk beside the repo's own `nx`. */
function load (): new (...arguments_: unknown[]) => Record<string, (...arguments_: unknown[]) => Promise<unknown>> & { validManifestFilenames: unknown } {
  const path = join(__dirname, `go-release-${process.pid}.generated.cjs`)
  writeFileSync(path, GO_RELEASE_SCRIPT)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS file written a moment ago.
    return require(path)
  } finally {
    rmSync(path, { force: true })
  }
}

describe('the generated script', () => {
  it('is valid JavaScript', () => {
    const path = join(workspaceRoot, 'go-app-release.cjs')
    writeFileSync(path, GO_RELEASE_SCRIPT)

    expect(spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' }).status).toBe(0)
  })

  it('declares no manifest, so Nx never looks for a package.json', () => {
    const actions = new (load())({}, {}, {})

    expect(actions.validManifestFilenames).toBeNull()
  })

  it('answers the first release, before any tag, with a 0.0.0 base to bump from', async () => {
    const actions = new (load())({}, { name: 'tool' }, { adjustSemverBumpsForZeroMajorVersion: false })

    await expect(actions.readCurrentVersionFromSourceManifest()).resolves.toMatchObject({ currentVersion: '0.0.0' })
    await expect(actions.calculateNewVersion('0.0.0', 'patch', 'CONVENTIONAL_COMMITS', {}, '')).resolves.toMatchObject({
      newVersion: '0.0.1',
    })
  })

  it('writes nothing: the version lives in the git tag alone', async () => {
    const actions = new (load())({}, {}, {})

    await expect(actions.updateProjectVersion({}, '1.2.3')).resolves.toEqual([])
    await expect(actions.updateProjectDependencies({}, {}, {})).resolves.toEqual([])
    await expect(actions.readCurrentVersionFromRegistry()).resolves.toBeNull()
  })

  it('refuses any command but assets when run directly', () => {
    const path = join(workspaceRoot, 'go-app-release.cjs')
    writeFileSync(path, GO_RELEASE_SCRIPT)

    const result = spawnSync(process.execPath, [path, 'nonsense'], { encoding: 'utf8', cwd: workspaceRoot, env: { ...process.env, NODE_PATH: join(__dirname, '../../../../node_modules') } })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: node tools/go-app-release.cjs assets')
  })
})

/** Runs `assets` with the given extra argument in the temporary workspace. */
function assets (...extra: string[]): { status: number | null; stdout: string; stderr: string } {
  const path = join(workspaceRoot, 'go-app-release.cjs')
  writeFileSync(path, GO_RELEASE_SCRIPT)

  return spawnSync(process.execPath, [path, 'assets', ...extra], {
    encoding: 'utf8',
    cwd:      workspaceRoot,
    env:      { ...process.env, NODE_PATH: join(__dirname, '../../../../node_modules') },
  })
}

describe('the generated script\'s assets command, for native apps (#263)', () => {
  it('leaves a native app to the native legs when run for the cross-compiled apps', () => {
    goApp('tray', { tags: ['type:go-app', 'build:cgo', 'release:go'] })

    const result = assets()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No releasable Go app - nothing to attach.')
  })

  it('leaves a cross-compiled app to the ubuntu job when run with --native', () => {
    goApp('tool', { tags: ['type:go-app', 'release:go'] })

    const result = assets('--native')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No releasable native Go app - nothing to attach.')
  })

  it('ignores an app that is native but not releasable, in either mode', () => {
    goApp('tray', { tags: ['type:go-app', 'build:cgo'] })

    expect(assets('--native').stdout).toContain('nothing to attach')
    expect(assets().stdout).toContain('nothing to attach')
  })

  it('refuses an unknown flag, naming the two it knows', () => {
    const result = assets('--nonsense')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: node tools/go-app-release.cjs assets [--native]')
  })
})

describe('the generated script\'s asset names (#317)', () => {
  type AssetName = (app: string, version: string, file: string, config: Record<string, unknown>) => string
  const assetName = (): AssetName => (load() as unknown as { assetName: AssetName }).assetName

  it('keeps the built name when no name is configured', () => {
    expect(assetName()('mvd-tray', '0.0.9', 'go-app-mvd-tray-darwin-arm64.zip', {})).toBe('go-app-mvd-tray-darwin-arm64.zip')
  })

  it('fills the template, with the product, the OS alias and the version', () => {
    const config = { name: '{product}_{version}_{os}_{arch}.{ext}', product: 'mvd', osAlias: { darwin: 'macos' } }

    expect(assetName()('mvd-tray', '0.0.9', 'go-app-mvd-tray-darwin-arm64.zip', config)).toBe('mvd_0.0.9_macos_arm64.zip')
    expect(assetName()('mvd-tray', '0.0.9', 'go-app-mvd-tray-windows-amd64.zip', config)).toBe('mvd_0.0.9_windows_amd64.zip')
  })

  it('defaults the product to the project name and honours an arch alias', () => {
    const config = { name: '{product}-{version}-{os}-{arch}.{ext}', archAlias: { amd64: 'x64' } }

    expect(assetName()('tool', '1.2.3', 'go-app-tool-linux-amd64.zip', config)).toBe('tool-1.2.3-linux-x64.zip')
  })

  it('leaves a file that is not a platform zip alone', () => {
    expect(assetName()('tool', '1.2.3', 'readme.txt', { name: '{product}.{ext}' })).toBe('readme.txt')
  })
})
