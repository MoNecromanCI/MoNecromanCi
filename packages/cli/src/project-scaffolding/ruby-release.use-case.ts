import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { addProjectJsonTargets } from './post-generation.use-case'

/**
 * The workspace-relative path every publishable `ruby-lib`'s `release.version.versionActions` points at.
 *
 * @remarks
 * A workspace file rather than an npm package, as the C#, Rust, C++, Java and PHP ones are: Nx resolves the value as a module
 * specifier and then as a path under the workspace root.
 */
export const RUBY_VERSION_ACTIONS_PATH = 'tools/ruby-version-actions.cjs'

/**
 * The `tools/ruby-version-actions.cjs` file every publishable `ruby-lib` shares.
 *
 * @remarks
 * `nx release` has no RubyGems support, so without this it falls back to its npm default, looks for a `package.json` a gem
 * does not have, and aborts while building the release graph. It reads and writes the `VERSION = '...'` constant in the
 * gem's `lib/<name>/version.rb`, which is where `bundle gem` puts it and where the gemspec reads it from, so the gemspec
 * needs no edit. The file is found by globbing the one `version.rb` under `lib/`, as the C# actions glob the `.csproj`.
 *
 * `readCurrentVersionFromRegistry` answers null: with conventional commits Nx resolves the current version from the git
 * tag, as for the other kinds. Written as `.cjs`, with no template literal inside, so it needs no escaping here.
 */
export const RUBY_VERSION_ACTIONS = String.raw`'use strict'

const { posix } = require('node:path')
const { VersionActions } = require('nx/release')

/* VERSION = '<x.y.z>': the prefix up to the version, and the version. */
const VERSION_CONSTANT = /^(\s*VERSION\s*=\s*['"])([^'"]+)(['"])/m

/**
 * Hand-written Nx release VersionActions for a publishable Ruby gem: reads and writes the VERSION constant of
 * lib/<name>/version.rb. Written by mnci add ruby-lib.
 */
class RubyVersionActions extends VersionActions {
  validManifestFilenames = ['version.rb']

  versionFile (tree) {
    const root = this.projectGraphNode.data.root
    const candidates = tree.children(posix.join(root, 'lib'))
      .map(entry => posix.join(root, 'lib', entry, 'version.rb'))
      .filter(path => tree.exists(path))

    return candidates[0]
  }

  async readCurrentVersionFromSourceManifest (tree) {
    const manifestPath = this.versionFile(tree)
    if (!manifestPath) {
      return null
    }
    const match = VERSION_CONSTANT.exec(tree.read(manifestPath, 'utf8') ?? '')
    if (!match) {
      throw new Error("Could not find VERSION = '<x.y.z>' in " + manifestPath)
    }

    return { currentVersion: match[2], manifestPath }
  }

  async readCurrentVersionFromRegistry (_tree, _currentVersionResolverMetadata) {
    return {
      currentVersion: null,
      logText:        'Ruby gems resolve their current version from git tags, not a registry lookup',
    }
  }

  async readCurrentVersionOfDependency (_tree, _projectGraph, _dependencyProjectName) {
    return { currentVersion: null, dependencyCollection: null }
  }

  async updateProjectVersion (tree, newVersion) {
    const manifestPath = this.versionFile(tree)
    if (!manifestPath) {
      throw new Error('The project "' + this.projectGraphNode.name + '" has no lib/<name>/version.rb')
    }
    const contents = tree.read(manifestPath, 'utf8') ?? ''
    if (!VERSION_CONSTANT.test(contents)) {
      throw new Error("Could not find VERSION = '<x.y.z>' in " + manifestPath)
    }
    tree.write(manifestPath, contents.replace(VERSION_CONSTANT, (_whole, before, _version, after) => before + newVersion + after))

    return ['Updated ' + manifestPath + ' to version ' + newVersion]
  }

  async updateProjectDependencies (_tree, _projectGraph, _dependenciesToUpdate) {
    return []
  }

  async validate (tree) {
    if (!this.versionFile(tree)) {
      throw new Error('The project "' + this.projectGraphNode.name + '" has no lib/<name>/version.rb in ' + this.projectGraphNode.data.root)
    }
  }
}

module.exports = RubyVersionActions
`

/**
 * The `nx-release-publish` target of a publishable `ruby-lib`: it publishes nothing and says so.
 *
 * @remarks
 * A gem is released by its git tag (and the GitHub Release `nx release` makes) until RubyGems publishing is wired: `gem push`
 * needs `GEM_HOST_API_KEY` passed to the release step by both CI providers, which the generated pipelines do not do yet
 * (#472). The target exists because `nx release publish` throws when no project of a release group carries one.
 *
 * @param name - The project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyLibPublishTarget (name: string): Record<string, unknown> {
  const message = `Ruby gem ${name} is released by its git tag, so there is nothing to upload.`

  return { executor: 'nx:run-commands', options: { command: `node -e "console.log('${message}')"` } }
}

/**
 * Wires `nx release` for a publishable Ruby gem: the shared version actions, the override and the publish target.
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
export function wireRubyLibRelease (workspaceRoot: string, projectRoot: string, name: string): void {
  writeFileEnsured(join(workspaceRoot, RUBY_VERSION_ACTIONS_PATH), RUBY_VERSION_ACTIONS)
  const projectJsonPath = join(workspaceRoot, projectRoot, 'project.json')
  const project = fileExists(projectJsonPath) ? readJson<Record<string, unknown>>(projectJsonPath) : {}
  const release = (project.release as Record<string, unknown> | undefined) ?? {}
  const version = (release.version as Record<string, unknown> | undefined) ?? {}
  writeFileEnsured(
    projectJsonPath,
    toJson({ ...project, release: { ...release, version: { ...version, versionActions: RUBY_VERSION_ACTIONS_PATH } } }),
  )
  addProjectJsonTargets(projectJsonPath, { 'nx-release-publish': rubyLibPublishTarget(name) })
}
