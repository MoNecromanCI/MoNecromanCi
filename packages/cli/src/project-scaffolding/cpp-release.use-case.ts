import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { addProjectJsonTargets } from './post-generation.use-case'

/**
 * The workspace-relative path every publishable `cpp-lib`'s `release.version.versionActions` points at.
 *
 * @remarks
 * A workspace file rather than an npm package, as the C# and Rust ones are: Nx resolves the value as a module specifier and
 * then as a path under the workspace root.
 */
export const CMAKE_VERSION_ACTIONS_PATH = 'tools/cmake-version-actions.cjs'

/**
 * The `tools/cmake-version-actions.cjs` file every publishable `cpp-lib` shares.
 *
 * @remarks
 * `nx release` has no CMake support, so without this it falls back to its npm default, looks for a `package.json` a CMake
 * project does not have, and aborts while building the release graph. It reads and writes the `VERSION` of the project's own
 * `project(<name> VERSION x.y.z ...)` call in `CMakeLists.txt`, on the text.
 *
 * `readCurrentVersionFromRegistry` answers null: C++ has no central registry, and with conventional commits Nx resolves the
 * current version from the git tag, as for the other kinds. Written as `.cjs`, with no template literal inside, so it needs no
 * escaping here.
 */
export const CMAKE_VERSION_ACTIONS = String.raw`'use strict'

const { posix } = require('node:path')
const { VersionActions } = require('nx/release')

const MANIFEST = 'CMakeLists.txt'

/* project(<name> VERSION <x.y.z> ...): the prefix up to the version, and the version. */
const PROJECT_VERSION = /^(\s*project\s*\(\s*[^\s)]+\s+VERSION\s+)(\d[^\s)]*)/im

/**
 * Hand-written Nx release VersionActions for a publishable C++ library: reads and writes the VERSION of the project() call
 * in the project's own CMakeLists.txt. Written by mnci add cpp-lib.
 */
class CmakeVersionActions extends VersionActions {
  validManifestFilenames = [MANIFEST]

  async readCurrentVersionFromSourceManifest (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      return null
    }
    const match = PROJECT_VERSION.exec(tree.read(manifestPath, 'utf8') ?? '')
    if (!match) {
      throw new Error('Could not find project(<name> VERSION x.y.z) in ' + manifestPath)
    }

    return { currentVersion: match[2], manifestPath }
  }

  async readCurrentVersionFromRegistry (_tree, _currentVersionResolverMetadata) {
    return {
      currentVersion: null,
      logText:        'C++ libraries resolve their current version from git tags, not a registry lookup',
    }
  }

  async readCurrentVersionOfDependency (_tree, _projectGraph, _dependencyProjectName) {
    return { currentVersion: null, dependencyCollection: null }
  }

  async updateProjectVersion (tree, newVersion) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    const contents = tree.read(manifestPath, 'utf8') ?? ''
    if (!PROJECT_VERSION.test(contents)) {
      throw new Error('Could not find project(<name> VERSION x.y.z) in ' + manifestPath)
    }
    tree.write(manifestPath, contents.replace(PROJECT_VERSION, (_whole, prefix) => prefix + newVersion))

    return ['Updated ' + manifestPath + ' to version ' + newVersion]
  }

  async updateProjectDependencies (_tree, _projectGraph, _dependenciesToUpdate) {
    return []
  }

  async validate (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      throw new Error('The project "' + this.projectGraphNode.name + '" does not have a CMakeLists.txt in ' + this.projectGraphNode.data.root)
    }
  }
}

module.exports = CmakeVersionActions
`

/**
 * The `nx-release-publish` target of a publishable `cpp-lib`: it publishes nothing and says so.
 *
 * @remarks
 * C++ has no central registry to upload to, so a library is released by its git tag (and the GitHub Release `nx release`
 * makes), which is how Flutter libraries and Go modules are released too. The target exists because `nx release publish`
 * throws when no project of a release group carries one.
 *
 * @param name - The project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function cppLibPublishTarget (name: string): Record<string, unknown> {
  const message = `C++ library ${name} is released by its git tag, so there is nothing to upload.`

  return { executor: 'nx:run-commands', options: { command: `node -e "console.log('${message}')"` } }
}

/**
 * Wires `nx release` for a publishable C++ library: the shared version actions, the override and the publish target.
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
export function wireCppLibRelease (workspaceRoot: string, projectRoot: string, name: string): void {
  writeFileEnsured(join(workspaceRoot, CMAKE_VERSION_ACTIONS_PATH), CMAKE_VERSION_ACTIONS)
  const projectJsonPath = join(workspaceRoot, projectRoot, 'project.json')
  const project = fileExists(projectJsonPath) ? readJson<Record<string, unknown>>(projectJsonPath) : {}
  const release = (project.release as Record<string, unknown> | undefined) ?? {}
  const version = (release.version as Record<string, unknown> | undefined) ?? {}
  writeFileEnsured(
    projectJsonPath,
    toJson({ ...project, release: { ...release, version: { ...version, versionActions: CMAKE_VERSION_ACTIONS_PATH } } }),
  )
  addProjectJsonTargets(projectJsonPath, { 'nx-release-publish': cppLibPublishTarget(name) })
}
