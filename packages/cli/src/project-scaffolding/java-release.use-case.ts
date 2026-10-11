import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { addProjectJsonTargets } from './post-generation.use-case'

/**
 * The workspace-relative path every publishable `java-lib`'s `release.version.versionActions` points at.
 *
 * @remarks
 * A workspace file rather than an npm package, as the C#, Rust and C++ ones are: Nx resolves the value as a module specifier
 * and then as a path under the workspace root.
 */
export const MAVEN_VERSION_ACTIONS_PATH = 'tools/maven-version-actions.cjs'

/**
 * The `tools/maven-version-actions.cjs` file every publishable `java-lib` shares.
 *
 * @remarks
 * `nx release` has no Maven support, so without this it falls back to its npm default, looks for a `package.json` a Maven
 * module does not have, and aborts while building the release graph. It reads and writes the module's own `<version>`: the
 * one that follows its `<artifactId>` after the `<parent>` block, on the text, so a dependency's or the parent's version is
 * never touched.
 *
 * `readCurrentVersionFromRegistry` answers null: with conventional commits Nx resolves the current version from the git
 * tag, as for the other kinds. Written as `.cjs`, with no template literal inside, so it needs no escaping here.
 */
export const MAVEN_VERSION_ACTIONS = String.raw`'use strict'

const { posix } = require('node:path')
const { VersionActions } = require('nx/release')

const MANIFEST = 'pom.xml'

/* The module's artifactId and the <version> that follows it, searched after the <parent> block (which has both too). */
const OWN_VERSION = /(<artifactId>[^<]+<\/artifactId>\s*<version>)([^<]+)(<\/version>)/

function ownVersion (text) {
  const parentEnd = text.indexOf('</parent>')
  const from = parentEnd === -1 ? 0 : parentEnd
  const match = OWN_VERSION.exec(text.slice(from))

  return match === null ? null : { from, match }
}

/**
 * Hand-written Nx release VersionActions for a publishable Java library: reads and writes the module's own <version> in its
 * pom.xml. Written by mnci add java-lib.
 */
class MavenVersionActions extends VersionActions {
  validManifestFilenames = [MANIFEST]

  async readCurrentVersionFromSourceManifest (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      return null
    }
    const found = ownVersion(tree.read(manifestPath, 'utf8') ?? '')
    if (!found) {
      throw new Error('Could not find the module <version> in ' + manifestPath)
    }

    return { currentVersion: found.match[2].trim(), manifestPath }
  }

  async readCurrentVersionFromRegistry (_tree, _currentVersionResolverMetadata) {
    return {
      currentVersion: null,
      logText:        'Java libraries resolve their current version from git tags, not a registry lookup',
    }
  }

  async readCurrentVersionOfDependency (_tree, _projectGraph, _dependencyProjectName) {
    return { currentVersion: null, dependencyCollection: null }
  }

  async updateProjectVersion (tree, newVersion) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    const contents = tree.read(manifestPath, 'utf8') ?? ''
    const found = ownVersion(contents)
    if (!found) {
      throw new Error('Could not find the module <version> in ' + manifestPath)
    }
    const head = contents.slice(0, found.from)
    const tail = contents.slice(found.from).replace(OWN_VERSION, (_whole, before, _version, after) => before + newVersion + after)
    tree.write(manifestPath, head + tail)

    return ['Updated ' + manifestPath + ' to version ' + newVersion]
  }

  async updateProjectDependencies (_tree, _projectGraph, _dependenciesToUpdate) {
    return []
  }

  async validate (tree) {
    const manifestPath = posix.join(this.projectGraphNode.data.root, MANIFEST)
    if (!tree.exists(manifestPath)) {
      throw new Error('The project "' + this.projectGraphNode.name + '" does not have a pom.xml in ' + this.projectGraphNode.data.root)
    }
  }
}

module.exports = MavenVersionActions
`

/**
 * The `nx-release-publish` target of a publishable `java-lib`: it publishes nothing and says so.
 *
 * @remarks
 * A Java library is released by its git tag (and the GitHub Release `nx release` makes) until a Maven repository is chosen:
 * Maven Central needs signing and a Central Portal account, and GitHub Packages or Azure Artifacts need a `settings.xml`
 * with the feed and its credentials (#470). The target exists because `nx release publish` throws when no project of a
 * release group carries one.
 *
 * @param name - The project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaLibPublishTarget (name: string): Record<string, unknown> {
  const message = `Java library ${name} is released by its git tag, so there is nothing to upload.`

  return { executor: 'nx:run-commands', options: { command: `node -e "console.log('${message}')"` } }
}

/**
 * Wires `nx release` for a publishable Java library: the shared version actions, the override and the publish target.
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
export function wireJavaLibRelease (workspaceRoot: string, projectRoot: string, name: string): void {
  writeFileEnsured(join(workspaceRoot, MAVEN_VERSION_ACTIONS_PATH), MAVEN_VERSION_ACTIONS)
  const projectJsonPath = join(workspaceRoot, projectRoot, 'project.json')
  const project = fileExists(projectJsonPath) ? readJson<Record<string, unknown>>(projectJsonPath) : {}
  const release = (project.release as Record<string, unknown> | undefined) ?? {}
  const version = (release.version as Record<string, unknown> | undefined) ?? {}
  writeFileEnsured(
    projectJsonPath,
    toJson({ ...project, release: { ...release, version: { ...version, versionActions: MAVEN_VERSION_ACTIONS_PATH } } }),
  )
  addProjectJsonTargets(projectJsonPath, { 'nx-release-publish': javaLibPublishTarget(name) })
}
