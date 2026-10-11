jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { CARGO_VERSION_ACTIONS, CARGO_VERSION_ACTIONS_PATH, rustLibPublishTarget, wireRustLibRelease } from './rust-release.use-case'

describe('wireRustLibRelease', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-rust-release-'))
    mkdirSync(join(workspaceRoot, 'packages/core'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'packages/core/project.json'), JSON.stringify({ name: 'core', targets: { build: {} } }))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('writes the shared version actions, points the project at it and adds the publish target beside its own targets', () => {
    wireRustLibRelease(workspaceRoot, 'packages/core', 'core')

    expect(readFileSync(join(workspaceRoot, CARGO_VERSION_ACTIONS_PATH), 'utf8')).toBe(CARGO_VERSION_ACTIONS)
    const project = JSON.parse(readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8'))
    expect(project.release.version.versionActions).toBe('tools/cargo-version-actions.cjs')
    expect(Object.keys(project.targets)).toEqual(['build', 'nx-release-publish'])
  })

  it('is idempotent', () => {
    wireRustLibRelease(workspaceRoot, 'packages/core', 'core')
    const once = readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8')
    wireRustLibRelease(workspaceRoot, 'packages/core', 'core')

    expect(readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8')).toBe(once)
  })
})

/** A `Cargo.toml` at a version, with one dependency whose own version must never be touched. */
function manifest (version: string): string {
  return ['[package]', 'name = "core"', `version = "${version}"`, '', '[dependencies]', 'serde = { version = "1.0" }', ''].join('\n')
}

describe('CARGO_VERSION_ACTIONS', () => {
  it('is a CommonJS module that parses, and reads and writes the [package] version, not a dependency version', async () => {
    const exported: { exports: unknown } = { exports: undefined }
    const nodeRequire = createRequire(__filename)
    // A stand-in base class: only the logic of the subclass is under test.
    const stubbedRequire = (name: string): unknown => (name === 'nx/release' ? { VersionActions: class {} } : nodeRequire(name))
    runInNewContext(CARGO_VERSION_ACTIONS, { require: stubbedRequire, module: exported })
    const Actions = exported.exports as new () => {
      projectGraphNode:                     { data: { root: string }, name: string }
      readCurrentVersionFromSourceManifest: (tree: unknown) => Promise<{ currentVersion: string } | null>
      updateProjectVersion:                 (tree: unknown, version: string) => Promise<string[]>
    }
    const actions = new Actions()
    actions.projectGraphNode = { data: { root: 'packages/core' }, name: 'core' }
    const files = new Map([['packages/core/Cargo.toml', manifest('0.1.0')]])
    const tree = {
      exists: (path: string) => files.has(path),
      read:   (path: string) => files.get(path),
      write:  (path: string, contents: string) => { files.set(path, contents) },
    }

    const read = await actions.readCurrentVersionFromSourceManifest(tree)
    await actions.updateProjectVersion(tree, '0.2.0')

    expect(read?.currentVersion).toBe('0.1.0')
    expect(files.get('packages/core/Cargo.toml')).toBe(manifest('0.2.0'))
  })
})

describe('rustLibPublishTarget', () => {
  it('is always present, runs cargo publish for the crate, and gates on its token and on a dry run', () => {
    const { command } = rustLibPublishTarget('core').options as { command: string }

    expect(command).toContain("'publish','-p','core','--allow-dirty'")
    expect(command).toContain('CARGO_REGISTRY_TOKEN')
    expect(command).toContain('NX_DRY_RUN')
    expect(command).toContain('--dryRun')
  })
})
