import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { GO_RELEASE_TAG } from '../workspace-overlay'

/**
 * Where the script lives in a workspace.
 *
 * @remarks
 * Also the value of a releasable app's `release.version.versionActions`, which Nx
 * resolves relative to the workspace root.
 */
export const GO_RELEASE_SCRIPT_PATH = 'tools/go-app-release.cjs'

/**
 * The `tools/go-app-release.cjs` script: the version actions and the asset upload of a releasable Go app.
 *
 * @remarks
 * One file with two roles, because both exist for the same reason: a Go app has no
 * manifest, and `nx release` is built around one.
 *
 * - **As `release.version.versionActions`.** Nx's default implementation reads a
 *   `package.json`, and a project without one aborts the release graph for every
 *   project in the workspace (the `go-lib` failure, and the Dart one before it). This
 *   class declares no manifest, so the version lives in the git tag alone, which is
 *   all mnci releases ever write (`git.commit` is `false`). The project's
 *   `currentVersionResolver` is `git-tag`; for the very first release, when no tag
 *   exists, the disk fallback is answered with a `0.0.0` base, so the first release is
 *   `0.0.1` (Nx's own rule for a `0.x` base) instead of a failure. To start elsewhere,
 *   push a `<name>@<version>` tag before the first release.
 * - **As `node tools/go-app-release.cjs assets`.** After `nx release` has tagged, it
 *   builds `package-all` with `VERSION` set to the tag's version, so the binary
 *   reports it, and attaches the per-platform zips to that tag's GitHub Release.
 *   Tags are read from `HEAD`, so a run that released nothing uploads nothing, and
 *   `--clobber` makes a re-run harmless.
 *
 * `nx` is run through its own `package.json` `bin` entry with the current `node`,
 * not through a shell, so a workspace path with a space in it works on Windows.
 */
export const GO_RELEASE_SCRIPT = String.raw`#!/usr/bin/env node
// Written by mnci: 'mnci add go-app --release' creates it and 'mnci upgrade'
// rewrites it, so local edits do not survive an upgrade.
//
// A releasable Go app (tag release:go) is versioned from its git tag, with no
// manifest, and its per-platform zips are attached to its GitHub Release:
//   release.version.versionActions   this file, loaded by 'nx release'
//   node tools/go-app-release.cjs assets
'use strict'
const { spawnSync } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { VersionActions } = require('nx/release')

const FIRST_RELEASE_BASE = '0.0.0'

class GoAppVersionActions extends VersionActions {
  validManifestFilenames = null

  async validate () {
    // Nothing on disk to check: there is no manifest.
  }

  async readCurrentVersionFromSourceManifest () {
    // Reached only as the fallback of the git-tag resolver, i.e. before the first tag.
    return { currentVersion: FIRST_RELEASE_BASE, manifestPath: 'none (a Go app is versioned by its git tag)' }
  }

  async readCurrentVersionFromRegistry () {
    return null
  }

  async readCurrentVersionOfDependency () {
    return { currentVersion: null, dependencyCollection: null }
  }

  async updateProjectVersion () {
    return []
  }

  async updateProjectDependencies () {
    return []
  }
}

module.exports = GoAppVersionActions

function fail (message) {
  console.error(message)
  process.exit(1)
}

function run (command, args, env) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env }, shell: false })
  if (result.status !== 0) fail(command + ' ' + args.join(' ') + ' failed (exit ' + result.status + ')')

  return result.stdout
}

function nx (args, env) {
  const manifest = require.resolve('nx/package.json')
  const bin = require(manifest).bin
  const entry = typeof bin === 'string' ? bin : bin.nx

  return run(process.execPath, [join(dirname(manifest), entry), ...args], env)
}

function releasableApps () {
  return JSON.parse(nx(['show', 'projects', '--projects', 'tag:release:go', '--json'])).filter(Boolean)
}

function attachAssets () {
  const apps = releasableApps()
  if (apps.length === 0) {
    console.log('No releasable Go app - nothing to attach.')

    return
  }
  const tags = run('git', ['tag', '--points-at', 'HEAD']).split(/\r?\n/).filter(Boolean)
  let attached = 0
  for (const app of apps) {
    const tag = tags.find(each => each.startsWith(app + '@'))
    if (!tag) {
      console.log(app + ': not released by this run - skipping.')
      continue
    }
    const version = tag.slice(app.length + 1)
    console.log(app + ': building the six platforms as ' + version)
    nx(['run', app + ':package-all'], { VERSION: version })
    const prefix = 'go-app-' + app + '-'
    const zips = existsSync('dist/drop') ? readdirSync('dist/drop').filter(each => each.startsWith(prefix) && each.endsWith('.zip')) : []
    if (zips.length === 0) fail(app + ': package-all produced no ' + prefix + '*.zip in dist/drop.')
    const upload = spawnSync('gh', ['release', 'upload', tag, ...zips.map(each => join('dist/drop', each)), '--clobber'], { stdio: 'inherit', shell: process.platform === 'win32' })
    if (upload.status !== 0) fail(app + ': could not attach the zips to the ' + tag + ' release (exit ' + upload.status + ').')
    console.log(app + ': attached ' + zips.length + ' zips to ' + tag)
    attached += 1
  }
  console.log(attached + ' release(s) carry their platform zips.')
}

if (require.main === module) {
  if (process.argv[2] !== 'assets') fail('Usage: node tools/go-app-release.cjs assets')
  attachAssets()
}
`

/** The slice of a `project.json` this module reads and writes. */
interface ReleasableProject {
  tags?:    string[]
  targets?: Record<string, unknown>
  release?: { version?: Record<string, unknown> }
}

/**
 * The `nx-release-publish` target of a releasable Go app, which publishes nothing.
 *
 * @remarks
 * The target has to exist, not because anything is published: `nx release` tags first
 * and publishes last, and a project matched for publishing without the target aborts
 * the run with exit 1 after the tag exists (measured). The same reason the VS Code
 * extension and the C# library carry one. Publishing a Go app is its tag, and the
 * zips are attached to its GitHub Release by `tools/go-app-release.cjs assets`.
 */
const GO_RELEASE_PUBLISH_TARGET = {
  executor: 'nx:run-commands',
  options:  {
    command: 'node -e "console.log(\'Published by its git tag; the platform zips are attached to the GitHub Release by tools/go-app-release.cjs assets.\')"',
  },
} as const

/**
 * Makes an existing Go app releasable: the tag, the project-level version config, and the script.
 *
 * @remarks
 * The tag is what puts the app in `nx release` scope (`release.projects` selects
 * `tag:release:go`, as it does for a VS Code extension), so an internal tool stays
 * unreleased unless it opts in. The project-level `release.version` is what keeps
 * Nx from looking for a `package.json`; it wins over the workspace default. The
 * no-op `nx-release-publish` target stops the publish phase aborting after the tag
 * exists. Safe to run twice, and a publish target the app already has is kept.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The Go app's project name.
 * @returns Nothing.
 * @throws Error when `apps/<name>/project.json` does not exist or is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function makeGoAppReleasable (workspaceRoot: string, name: string): void {
  const projectJsonPath = join(workspaceRoot, 'apps', name, 'project.json')
  if (!fileExists(projectJsonPath)) {
    throw new Error(`No Go app at apps/${name}: cannot make it releasable.`)
  }
  const project = readJson<ReleasableProject>(projectJsonPath)
  writeFileEnsured(
    projectJsonPath,
    toJson({
      ...project,
      tags:    [...new Set([...(project.tags ?? []), GO_RELEASE_TAG])],
      targets: { ...project.targets, 'nx-release-publish': project.targets?.['nx-release-publish'] ?? GO_RELEASE_PUBLISH_TARGET },
      release: {
        ...project.release,
        version: {
          ...project.release?.version,
          versionActions:         GO_RELEASE_SCRIPT_PATH,
          currentVersionResolver: 'git-tag',
        },
      },
    }),
  )
  writeFileEnsured(join(workspaceRoot, GO_RELEASE_SCRIPT_PATH), GO_RELEASE_SCRIPT)
}

/**
 * Rewrites {@link GO_RELEASE_SCRIPT_PATH} when the workspace has a releasable Go app.
 *
 * @remarks
 * Called by `mnci upgrade`, so a fix to the script reaches every workspace that
 * uses it, and a workspace with no releasable Go app never gains the file.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Whether the file changed (an up-to-date script is left alone).
 * @throws Propagates any `fs` error writing the file.
 * @typeParam None - this function has no generic type parameters.
 */
export function refreshGoReleaseScript (workspaceRoot: string): boolean {
  const apps = join(workspaceRoot, 'apps')
  let entries: string[]
  try {
    entries = readdirSync(apps)
  } catch {
    return false
  }
  const hasReleasableApp = entries.some((entry) => {
    const projectJsonPath = join(apps, entry, 'project.json')

    return fileExists(projectJsonPath) && (readJson<ReleasableProject>(projectJsonPath).tags ?? []).includes(GO_RELEASE_TAG)
  })
  const path = join(workspaceRoot, GO_RELEASE_SCRIPT_PATH)
  if (!hasReleasableApp || (fileExists(path) && readFileSync(path, 'utf8') === GO_RELEASE_SCRIPT)) {
    return false
  }
  writeFileEnsured(path, GO_RELEASE_SCRIPT)

  return true
}
