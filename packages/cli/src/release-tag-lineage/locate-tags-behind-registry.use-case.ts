import { globSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../file-system'
import { runCapture } from '../nx-workspace'
import { locateRegistryVersions } from './locate-registry-versions.use-case'
import { latestTaggedVersions, versionsBehindRegistry, type TagBehindRegistry } from './stranded-release-tags.algorithm'

/**
 * Finds the publishable npm packages whose registry is ahead of their newest release tag.
 *
 * @remarks
 * Only a package that already has a tag under its own name is looked up: with none, the first
 * release is a brand-new publish and there is nothing to compare, and a fresh workspace pays for
 * no network call. The registry is asked through `npm view`, so the workspace's `.npmrc` decides
 * where. An unreachable registry or an unknown package is left out, never reported.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param lookup - How the published versions are read; the registry unless a caller supplies one.
 * @returns One entry per package behind the registry.
 * @throws Never - a repository without tags has nothing to compare.
 * @typeParam None - this function has no generic type parameters.
 */
export function locateTagsBehindRegistry (
  workspaceRoot: string,
  lookup: (root: string, projects: readonly string[]) => Map<string, string> = locateRegistryVersions,
): TagBehindRegistry[] {
  const listed = runCapture('git', ['tag', '--list'], workspaceRoot)
  if (listed.status !== 0) {
    return []
  }
  const projects = globSync('{apps,libs,packages}/*/package.json', { cwd: workspaceRoot })
    .map(path => readJson<{ name?: string, private?: boolean }>(join(workspaceRoot, path)))
    .filter(manifest => manifest.private !== true && manifest.name !== undefined)
    .map(manifest => manifest.name as string)
  const tagged = latestTaggedVersions(projects, listed.stdout.split(/\r?\n/).filter(Boolean))
  if (tagged.size === 0) {
    return []
  }

  return versionsBehindRegistry(tagged, lookup(workspaceRoot, tagged.keys().toArray()))
}
