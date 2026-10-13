import { globSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../file-system'
import { runCapture } from '../nx-workspace'
import { locateRegistryVersions } from './locate-registry-versions.use-case'
import { untaggedPublished, type UntaggedPublished } from './stranded-release-tags.algorithm'

/**
 * Finds the publishable npm packages the registry holds that have no release tag at all, under any name.
 *
 * @remarks
 * `nx release` starts such a package from its `package.json` version, usually the scaffold's `0.0.1`, and proposes a version
 * far below what is published: the failure behind "Unable to resolve the current version from git tags". It is also what a
 * clone made without `git fetch --tags` looks like, so the answer is only as good as the tags the clone has.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param lookup - How the published versions are read; the registry unless a caller supplies one.
 * @returns One entry per published package with no tag.
 * @throws Never - a repository without tags, or an unreachable registry, reports nothing.
 * @typeParam None - this function has no generic type parameters.
 */
export function locateUntaggedPublished (
  workspaceRoot: string,
  lookup: (root: string, projects: readonly string[]) => Map<string, string> = locateRegistryVersions,
): UntaggedPublished[] {
  const listed = runCapture('git', ['tag', '--list'], workspaceRoot)
  if (listed.status !== 0) {
    return []
  }
  const projects = globSync('{apps,libs,packages}/*/package.json', { cwd: workspaceRoot })
    .map(path => readJson<{ name?: string, private?: boolean }>(join(workspaceRoot, path)))
    .filter(manifest => manifest.private !== true && manifest.name !== undefined)
    .map(manifest => manifest.name as string)
  if (projects.length === 0) {
    return []
  }

  return untaggedPublished(projects, listed.stdout.split(/\r?\n/).filter(Boolean), lookup(workspaceRoot, projects))
}
