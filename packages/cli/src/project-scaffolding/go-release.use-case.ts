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
 *   `--clobber` makes a re-run harmless. With `--native` it does the same for the
 *   apps tagged `build:cgo`, which cannot be cross-compiled: each native CI leg runs
 *   it on its own OS and builds `package-native`, so the one release collects a zip
 *   from every runner.
 * - **What the attached files are called** is the app's choice (#317): `release.asset` in its
 *   `project.json` gives a name template (`{product}_{version}_{os}_{arch}.{ext}`), a product name,
 *   OS and architecture aliases (`darwin` as `macos`), and `extra` targets whose output (a `.dmg` built
 *   by the app's own target) is attached too. The zips are renamed on the way to the release, so the
 *   build targets, their cache and `VERSION` handling are untouched.
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
//   node tools/go-app-release.cjs assets            the apps built for all six platforms
//   node tools/go-app-release.cjs assets --native   the apps that need a C toolchain, this OS only
//
// What an attached file is called is the app's own choice, in its project.json (#317):
//   "release": { "asset": {
//     "name": "{product}_{version}_{os}_{arch}.{ext}",   placeholders: product, version, os, arch, ext
//     "product": "mvd",                                  default: the project name
//     "osAlias": { "darwin": "macos" },                  Go's name -> the one you write
//     "archAlias": {},
//     "extra": [{ "target": "package-dmg", "files": "dist/dmg/mvd_{version}_macos_universal.dmg" }]
//   } }
// Without "name" the zips keep the name package-all gave them. Each "extra" runs the app's target with VERSION
// set and attaches what "files" matches (a glob, {version} filled in), under the name it already has.
'use strict'
const { spawnSync } = require('node:child_process')
const { copyFileSync, existsSync, globSync, mkdirSync, readdirSync, readFileSync, rmSync } = require('node:fs')
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
module.exports.assetName = (...arguments_) => assetName(...arguments_)

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

const ASSET_PLACEHOLDERS = ['product', 'version', 'os', 'arch', 'ext']

function assetConfig (app) {
  try {
    return JSON.parse(readFileSync(join('apps', app, 'project.json'), 'utf8')).release?.asset || {}
  } catch {
    return {}
  }
}

// 'go-app-<app>-<goos>-<goarch>.zip' -> { os, arch, ext }, or undefined for any other file.
function parseBuiltName (app, file) {
  const prefix = 'go-app-' + app + '-'
  if (!file.startsWith(prefix) || !file.endsWith('.zip')) return null
  const platform = file.slice(prefix.length, -'.zip'.length)
  const dash = platform.lastIndexOf('-')
  if (dash < 1) return null

  return { os: platform.slice(0, dash), arch: platform.slice(dash + 1), ext: 'zip' }
}

// What a built zip is attached as. Without a configured name the file keeps the name it was built with.
function assetName (app, version, file, config) {
  const parts = parseBuiltName(app, file)
  if (!parts || !config.name) return file

  const os = (config.osAlias || {})[parts.os] || parts.os
  const arch = (config.archAlias || {})[parts.arch] || parts.arch
  const values = { product: config.product || app, version, os, arch, ext: parts.ext }

  return config.name.replaceAll(/\{(\w+)\}/g, (_match, key) => {
    if (!ASSET_PLACEHOLDERS.includes(key)) fail(app + ': release.asset.name has an unknown placeholder {' + key + '} - use ' + ASSET_PLACEHOLDERS.map(each => '{' + each + '}').join(', ') + '.')

    return values[key]
  })
}

function releasableApps (native) {
  const names = existsSync('apps') ? readdirSync('apps') : []

  return names.filter(name => {
    try {
      const tags = JSON.parse(readFileSync(join('apps', name, 'project.json'), 'utf8')).tags || []

      return tags.includes('release:go') && tags.includes('build:cgo') === native
    } catch {
      return false
    }
  })
}

function attachAssets (native) {
  const apps = releasableApps(native)
  if (apps.length === 0) {
    console.log('No releasable ' + (native ? 'native ' : '') + 'Go app - nothing to attach.')

    return
  }
  const target = native ? 'package-native' : 'package-all'
  const tags = run('git', ['tag', '--points-at', 'HEAD']).split(/\r?\n/).filter(Boolean)
  let attached = 0
  for (const app of apps) {
    const tag = tags.find(each => each.startsWith(app + '@'))
    if (!tag) {
      console.log(app + ': not released by this run - skipping.')
      continue
    }
    const version = tag.slice(app.length + 1)
    console.log(app + ': ' + (native ? 'building for this OS' : 'building the six platforms') + ' as ' + version)
    nx(['run', app + ':' + target], { VERSION: version })
    const config = assetConfig(app)
    const built = existsSync('dist/drop') ? readdirSync('dist/drop').filter(each => parseBuiltName(app, each)) : []
    if (built.length === 0) fail(app + ': ' + target + ' produced no go-app-' + app + '-*.zip in dist/drop.')
    const staging = join('dist', 'release-assets', app)
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    const files = built.map(each => {
      const name = assetName(app, version, each, config)
      copyFileSync(join('dist/drop', each), join(staging, name))

      return join(staging, name)
    })
    const extras = config.extra || []
    for (const extra of extras) {
      if (!extra.target || !extra.files) fail(app + ': each release.asset.extra needs a target and files.')
      nx(['run', app + ':' + extra.target], { VERSION: version })
      const found = globSync(extra.files.replaceAll('{version}', () => version))
      if (found.length === 0) fail(app + ': ' + extra.target + ' produced nothing matching ' + extra.files + '.')
      files.push(...found)
    }
    const upload = spawnSync('gh', ['release', 'upload', tag, ...files, '--clobber'], { stdio: 'inherit', shell: process.platform === 'win32' })
    if (upload.status !== 0) fail(app + ': could not attach the files to the ' + tag + ' release (exit ' + upload.status + ').')
    console.log(app + ': attached ' + files.length + ' file(s) to ' + tag)
    attached += 1
  }
  console.log(attached + ' release(s) carry their platform zips.')
}

if (require.main === module) {
  if (process.argv[2] !== 'assets' || (process.argv[3] !== undefined && process.argv[3] !== '--native')) fail('Usage: node tools/go-app-release.cjs assets [--native]')
  attachAssets(process.argv[3] === '--native')
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
