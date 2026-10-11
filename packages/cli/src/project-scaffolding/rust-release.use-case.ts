import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { addProjectJsonTargets } from './post-generation.use-case'

/**
 * The workspace-relative path every publishable `rust-lib`'s `release.version.versionActions` points at.
 *
 * @remarks
 * A workspace file rather than an npm package, for the reason the C# one is: Nx resolves the value as a module specifier and
 * then as a path under the workspace root, so a hand-written `.cjs` needs no package to scaffold, publish and keep versioned
 * to carry one class.
 */
export const CARGO_VERSION_ACTIONS_PATH = 'tools/cargo-version-actions.cjs'

/**
 * The `tools/cargo-version-actions.cjs` file every publishable `rust-lib` shares.
 *
 * @remarks
 * `nx release` has no Cargo support, so without this it falls back to its npm default, looks for a `package.json` a crate does
 * not have, and aborts while building the release graph (the failure `go-lib` and `csharp-lib` each hit). It reads and writes
 * the `version` of the crate's own `[package]` table in `Cargo.toml`, on the text, so the rest of the file is left as it is.
 *
 * `readCurrentVersionFromRegistry` answers null: with conventional commits Nx resolves the current version from the git tag and
 * reads the manifest only as the first-release fallback, as for the other kinds.
 *
 * Written as `.cjs`, so it resolves as CommonJS whatever `"type"` the root `package.json` declares. The text holds no template
 * literal, so it needs no escaping here.
 */
export const CARGO_VERSION_ACTIONS = String.raw`'use strict'

const { posix } = require('node:path')
const { VersionActions } = require('nx/release')

const MANIFEST = 'Cargo.toml'

/* The index of the first version = "..." line inside the [package] table, or -1. */
function versionLine (lines) {
  let inPackage = false
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (trimmed.startsWith('[')) {
      inPackage = trimmed === '[package]'
      continue
    }
    if (inPackage && /^version\s*=\s*"[^"]*"/.test(trimmed)) {
      return index
    }
  }

  return -1
}

/**
 * Hand-written Nx release VersionActions for a publishable Rust crate: reads and writes the version of the crate's own
 * Cargo.toml. Written by mnci add rust-lib.
 */
class CargoVersionActions extends VersionActions {
  validManifestFilenames = [MANIFEST]

  async readCurrentVersionFromSourceManifest (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      return null
    }
    const lines = (tree.read(manifestPath, 'utf8') ?? '').split(/\r?\n/)
    const index = versionLine(lines)
    if (index === -1) {
      throw new Error('Could not find a version in the [package] table of ' + manifestPath)
    }

    return { currentVersion: /"([^"]*)"/.exec(lines[index])[1], manifestPath }
  }

  async readCurrentVersionFromRegistry (_tree, _currentVersionResolverMetadata) {
    return {
      currentVersion: null,
      logText:        'Rust crates resolve their current version from git tags, not a registry lookup',
    }
  }

  async readCurrentVersionOfDependency (_tree, _projectGraph, _dependencyProjectName) {
    return { currentVersion: null, dependencyCollection: null }
  }

  async updateProjectVersion (tree, newVersion) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    const contents = tree.read(manifestPath, 'utf8') ?? ''
    const newline = contents.includes('\r\n') ? '\r\n' : '\n'
    const lines = contents.split(/\r?\n/)
    const index = versionLine(lines)
    if (index === -1) {
      throw new Error('Could not find a version in the [package] table of ' + manifestPath)
    }
    lines[index] = lines[index].replace(/"[^"]*"/, '"' + newVersion + '"')
    tree.write(manifestPath, lines.join(newline))

    return ['Updated ' + manifestPath + ' to version ' + newVersion]
  }

  async updateProjectDependencies (_tree, _projectGraph, _dependenciesToUpdate) {
    return []
  }

  async validate (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      throw new Error('The project "' + this.projectGraphNode.name + '" does not have a Cargo.toml in ' + this.projectGraphNode.data.root)
    }
  }
}

module.exports = CargoVersionActions
`

/**
 * The `nx-release-publish` target of a publishable `rust-lib`: `cargo publish`, gated at runtime on its token.
 *
 * @remarks
 * Always present, never conditioned on anything at generation time: `nx release publish` throws when no project of a release
 * group carries a target of that name, so the target exists and decides when it runs, as the NuGet one does.
 *
 * - A dry run (`--dryRun`, or `NX_DRY_RUN`) prints what would be published and publishes nothing, whether or not the token is
 *   set (a dry-run release still runs every `nx-release-publish` target).
 * - With no `CARGO_REGISTRY_TOKEN` it says publishing is not configured and exits 0, so a workspace that releases only npm
 *   packages is not failed by a crate.
 * - `--allow-dirty` because `nx release` writes the new version into `Cargo.toml` and commits nothing (it is tag-only), and
 *   cargo refuses to publish a dirty tree otherwise.
 *
 * The token is read by cargo itself from `CARGO_REGISTRY_TOKEN`. Only crates.io is wired: another registry needs its own
 * `[registries]` entry and token name.
 *
 * @param name - The crate and project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function rustLibPublishTarget (name: string): Record<string, unknown> {
  const script = [
    "if(process.argv.some(a=>a==='--dryRun'||a==='--dryRun=true')||process.env.NX_DRY_RUN==='true'){",
    `console.log('Dry run - would cargo publish ${name} to crates.io.');process.exit(0)}`,
    "if(!process.env.CARGO_REGISTRY_TOKEN){console.log('crates.io publish is not configured (no CARGO_REGISTRY_TOKEN) - skipping.');process.exit(0)}",
    "const r=require('node:child_process').spawnSync('cargo',",
    `['publish','-p','${name}','--allow-dirty','--target-dir','dist/target/${name}'],{stdio:'inherit',shell:true});`,
    'process.exit(r.status??1)',
  ].join('')

  return { executor: 'nx:run-commands', options: { command: `node -e "${script}"` } }
}

/**
 * Wires `nx release` for a publishable Rust crate: the shared version actions, the project's override and the publish target.
 *
 * @remarks
 * Idempotent: the shared file is rewritten with identical content and the project's override and target are merged in place.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projectRoot - Workspace-relative crate directory (`packages/<name>`).
 * @param name - The crate and project name.
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error reading or writing the files.
 * @typeParam None - this function has no generic type parameters.
 */
export function wireRustLibRelease (workspaceRoot: string, projectRoot: string, name: string): void {
  writeFileEnsured(join(workspaceRoot, CARGO_VERSION_ACTIONS_PATH), CARGO_VERSION_ACTIONS)
  const projectJsonPath = join(workspaceRoot, projectRoot, 'project.json')
  const project = fileExists(projectJsonPath) ? readJson<Record<string, unknown>>(projectJsonPath) : {}
  const release = (project.release as Record<string, unknown> | undefined) ?? {}
  const version = (release.version as Record<string, unknown> | undefined) ?? {}
  writeFileEnsured(
    projectJsonPath,
    toJson({ ...project, release: { ...release, version: { ...version, versionActions: CARGO_VERSION_ACTIONS_PATH } } }),
  )
  addProjectJsonTargets(projectJsonPath, { 'nx-release-publish': rustLibPublishTarget(name) })
}
