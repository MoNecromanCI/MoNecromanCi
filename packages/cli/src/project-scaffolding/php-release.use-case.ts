import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { addProjectJsonTargets } from './post-generation.use-case'

/**
 * The workspace-relative path every publishable `php-lib`'s `release.version.versionActions` points at.
 *
 * @remarks
 * A workspace file rather than an npm package, as the C#, Rust, C++ and Java ones are: Nx resolves the value as a module
 * specifier and then as a path under the workspace root.
 */
export const COMPOSER_VERSION_ACTIONS_PATH = 'tools/composer-version-actions.cjs'

/**
 * The `tools/composer-version-actions.cjs` file every publishable `php-lib` shares.
 *
 * @remarks
 * `nx release` has no Composer support, so without this it falls back to its npm default, looks for a `package.json` a
 * Composer package does not have, and aborts while building the release graph. Composer takes a published package's version
 * from its git tag and discourages (and `validate --strict` warns about) a `version` key, so the version Nx reads and writes
 * is `extra.mnci.version` of the package's own `composer.json`, which Composer ignores. The file is edited as JSON with its
 * own indentation kept.
 *
 * `readCurrentVersionFromRegistry` answers null: with conventional commits Nx resolves the current version from the git
 * tag, as for the other kinds. Written as `.cjs`, with no template literal inside, so it needs no escaping here.
 */
export const COMPOSER_VERSION_ACTIONS = String.raw`'use strict'

const { posix } = require('node:path')
const { VersionActions } = require('nx/release')

const MANIFEST = 'composer.json'

/* The indentation a file uses, so a rewrite does not reformat it. */
function indentOf (text) {
  const match = /^([ \t]+)"/m.exec(text)

  return match ? match[1] : '    '
}

/**
 * Hand-written Nx release VersionActions for a publishable PHP library: reads and writes extra.mnci.version of the
 * package's own composer.json. Written by mnci add php-lib.
 */
class ComposerVersionActions extends VersionActions {
  validManifestFilenames = [MANIFEST]

  async readCurrentVersionFromSourceManifest (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      return null
    }
    const manifest = JSON.parse(tree.read(manifestPath, 'utf8') ?? '{}')
    const version = manifest.extra && manifest.extra.mnci && manifest.extra.mnci.version
    if (typeof version !== 'string') {
      throw new Error('Could not find extra.mnci.version in ' + manifestPath)
    }

    return { currentVersion: version, manifestPath }
  }

  async readCurrentVersionFromRegistry (_tree, _currentVersionResolverMetadata) {
    return {
      currentVersion: null,
      logText:        'PHP libraries resolve their current version from git tags, not a registry lookup',
    }
  }

  async readCurrentVersionOfDependency (_tree, _projectGraph, _dependencyProjectName) {
    return { currentVersion: null, dependencyCollection: null }
  }

  async updateProjectVersion (tree, newVersion) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    const text = tree.read(manifestPath, 'utf8') ?? '{}'
    const manifest = JSON.parse(text)
    manifest.extra = manifest.extra || {}
    manifest.extra.mnci = manifest.extra.mnci || {}
    manifest.extra.mnci.version = newVersion
    tree.write(manifestPath, JSON.stringify(manifest, null, indentOf(text)) + '\n')

    return ['Updated ' + manifestPath + ' to version ' + newVersion]
  }

  async updateProjectDependencies (_tree, _projectGraph, _dependenciesToUpdate) {
    return []
  }

  async validate (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      throw new Error('The project "' + this.projectGraphNode.name + '" does not have a composer.json in ' + this.projectGraphNode.data.root)
    }
  }
}

module.exports = ComposerVersionActions
`

/**
 * The `nx-release-publish` target of a publishable `php-lib`: it publishes nothing and says so.
 *
 * @remarks
 * Packagist reads a package's tags from its repository (a webhook), so a PHP library is released by its git tag and the
 * GitHub Release `nx release` makes, as a Go module is. There is nothing to upload. The target exists because
 * `nx release publish` throws when no project of a release group carries one.
 *
 * @param name - The project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpLibPublishTarget (name: string): Record<string, unknown> {
  const message = `PHP library ${name} is released by its git tag, which Packagist reads, so there is nothing to upload.`

  return { executor: 'nx:run-commands', options: { command: `node -e "console.log('${message}')"` } }
}

/**
 * Wires `nx release` for a publishable PHP library: the shared version actions, the override and the publish target.
 *
 * @remarks
 * Idempotent: the shared file is rewritten with identical content and the override and target are merged in place.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projectRoot - Workspace-relative project directory (`packages/<name>`).
 * @param name - The project name.
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error reading or writing the files.
 * @typeParam None - this function has no generic type parameters.
 */
export function wirePhpLibRelease (workspaceRoot: string, projectRoot: string, name: string): void {
  writeFileEnsured(join(workspaceRoot, COMPOSER_VERSION_ACTIONS_PATH), COMPOSER_VERSION_ACTIONS)
  const projectJsonPath = join(workspaceRoot, projectRoot, 'project.json')
  const project = fileExists(projectJsonPath) ? readJson<Record<string, unknown>>(projectJsonPath) : {}
  const release = (project.release as Record<string, unknown> | undefined) ?? {}
  const version = (release.version as Record<string, unknown> | undefined) ?? {}
  writeFileEnsured(
    projectJsonPath,
    toJson({ ...project, release: { ...release, version: { ...version, versionActions: COMPOSER_VERSION_ACTIONS_PATH } } }),
  )
  addProjectJsonTargets(projectJsonPath, { 'nx-release-publish': phpLibPublishTarget(name) })
}
