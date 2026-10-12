import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { addProjectJsonTargets } from './post-generation.use-case'

/**
 * The workspace-relative path every publishable `kotlin-lib`'s `release.version.versionActions` points at.
 *
 * @remarks
 * A workspace file rather than an npm package, as the C#, Rust, C++ and Maven ones are: Nx resolves the value as a module
 * specifier and then as a path under the workspace root.
 */
export const GRADLE_VERSION_ACTIONS_PATH = 'tools/gradle-version-actions.cjs'

/**
 * The `tools/gradle-version-actions.cjs` file every publishable `kotlin-lib` shares.
 *
 * @remarks
 * `nx release` has no Gradle support, so without this it falls back to its npm default, looks for a `package.json` a
 * Gradle project does not have, and aborts while building the release graph. It reads and writes the project's own
 * `version = "x"` line in `build.gradle.kts`, on the text, so a dependency's version in the catalog is never touched.
 *
 * `readCurrentVersionFromRegistry` answers null: with conventional commits Nx resolves the current version from the git
 * tag, as for the other kinds. Written as `.cjs`, with no template literal inside, so it needs no escaping here.
 */
export const GRADLE_VERSION_ACTIONS = String.raw`'use strict'

const { posix } = require('node:path')
const { VersionActions } = require('nx/release')

const MANIFEST = 'build.gradle.kts'

/* The project's own version line, at the start of a line: version = "1.2.3". */
const OWN_VERSION = /^(version\s*=\s*")([^"]+)(")/m

/**
 * Hand-written Nx release VersionActions for a publishable Kotlin library: reads and writes the version line of its
 * build.gradle.kts. Written by mnci add kotlin-lib.
 */
class GradleVersionActions extends VersionActions {
  validManifestFilenames = [MANIFEST]

  async readCurrentVersionFromSourceManifest (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      return null
    }
    const match = OWN_VERSION.exec(tree.read(manifestPath, 'utf8') ?? '')
    if (!match) {
      throw new Error('Could not find a version = "x" line in ' + manifestPath)
    }

    return { currentVersion: match[2].trim(), manifestPath }
  }

  async readCurrentVersionFromRegistry (_tree, _currentVersionResolverMetadata) {
    return {
      currentVersion: null,
      logText:        'Kotlin libraries resolve their current version from git tags, not a registry lookup',
    }
  }

  async readCurrentVersionOfDependency (_tree, _projectGraph, _dependencyProjectName) {
    return { currentVersion: null, dependencyCollection: null }
  }

  async updateProjectVersion (tree, newVersion) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    const contents = tree.read(manifestPath, 'utf8') ?? ''
    if (!OWN_VERSION.test(contents)) {
      throw new Error('Could not find a version = "x" line in ' + manifestPath)
    }
    tree.write(manifestPath, contents.replace(OWN_VERSION, (_whole, before, _version, after) => before + newVersion + after))

    return ['Updated ' + manifestPath + ' to version ' + newVersion]
  }

  async updateProjectDependencies (_tree, _projectGraph, _dependenciesToUpdate) {
    return []
  }

  async validate (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      throw new Error('The project "' + this.projectGraphNode.name + '" does not have a build.gradle.kts in ' + this.projectGraphNode.data.root)
    }
  }
}

module.exports = GradleVersionActions
`

/**
 * The `nx-release-publish` target of a publishable `kotlin-lib`: it publishes nothing and says so.
 *
 * @remarks
 * A Kotlin library is released by its git tag (and the GitHub Release `nx release` makes) until a Maven repository is
 * chosen: Maven Central needs signing and a Central Portal account, and GitHub Packages or Azure Artifacts need the feed
 * and its credentials in Gradle's publishing block (#492). The target exists because `nx release publish` throws when no
 * project of a release group carries one.
 *
 * @param name - The project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function kotlinLibPublishTarget (name: string): Record<string, unknown> {
  const message = `Kotlin library ${name} is released by its git tag, so there is nothing to upload.`

  return { executor: 'nx:run-commands', options: { command: `node -e "console.log('${message}')"` } }
}

/**
 * Wires `nx release` for a publishable Kotlin library: the shared version actions, the override and the publish target.
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
export function wireKotlinLibRelease (workspaceRoot: string, projectRoot: string, name: string): void {
  writeFileEnsured(join(workspaceRoot, GRADLE_VERSION_ACTIONS_PATH), GRADLE_VERSION_ACTIONS)
  const projectJsonPath = join(workspaceRoot, projectRoot, 'project.json')
  const project = fileExists(projectJsonPath) ? readJson<Record<string, unknown>>(projectJsonPath) : {}
  const release = (project.release as Record<string, unknown> | undefined) ?? {}
  const version = (release.version as Record<string, unknown> | undefined) ?? {}
  writeFileEnsured(
    projectJsonPath,
    toJson({ ...project, release: { ...release, version: { ...version, versionActions: GRADLE_VERSION_ACTIONS_PATH } } }),
  )
  addProjectJsonTargets(projectJsonPath, { 'nx-release-publish': kotlinLibPublishTarget(name) })
}
