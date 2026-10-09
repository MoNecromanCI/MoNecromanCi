import { globSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { releaseGoModule, type ReleaseGoModuleOptions } from './release-go-module.use-case'

/** The tag every `go-lib` project carries in its `project.json`. */
const GO_LIB_TAG = 'type:go-lib'

/**
 * Lists the Go libraries of a workspace, by directory.
 *
 * @remarks
 * A `go-lib` lives in `packages/<name>` with its own `go.mod`, and is excluded from `nx release` because Nx's
 * default version actions look for a `package.json` it does not have. It is released here instead, by tag.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The directories relative to the root, with forward slashes, sorted.
 * @throws Never - an unreadable `project.json` is not a Go library.
 * @typeParam None - this function has no generic type parameters.
 */
export function listGoLibraryDirectories (workspaceRoot: string): string[] {
  return globSync('packages/*/project.json', { cwd: workspaceRoot })
    .filter(file => {
      try {
        const project = JSON.parse(readFileSync(join(workspaceRoot, file), 'utf8')) as { tags?: unknown }

        return Array.isArray(project.tags) && project.tags.includes(GO_LIB_TAG)
      } catch {
        return false
      }
    })
    .map(file => dirname(file).replaceAll('\\', '/'))
    .toSorted((a, b) => a.localeCompare(b))
}

/**
 * Tags every Go library whose commits call for a release.
 *
 * @remarks
 * Each library is versioned on its own, from the conventional commits that touched its directory (see
 * {@link releaseGoModule}). Nothing propagates between modules: a library that requires another one has its
 * `require` bumped by hand when the dependency is tagged.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param options - Runs git and logs; the rest is the same for every library.
 * @returns The tags created (or that would be, in a dry run).
 * @throws Error when a git command fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function releaseGoLibraries (workspaceRoot: string, options: Omit<ReleaseGoModuleOptions, 'directory'>): string[] {
  const tags: string[] = []
  for (const directory of listGoLibraryDirectories(workspaceRoot)) {
    const released = releaseGoModule({ ...options, directory })
    if (released !== undefined) {
      tags.push(released.tag)
    }
  }

  return tags
}
