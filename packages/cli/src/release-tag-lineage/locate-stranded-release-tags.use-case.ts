import { globSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../file-system'
import { runCapture } from '../nx-workspace'
import { findStrandedReleaseTags, type StrandedReleaseTag } from './stranded-release-tags.algorithm'

/** The tag pattern mnci writes, and the only one the lookup in {@link findStrandedReleaseTags} models. */
const MNCI_TAG_PATTERN = '{projectName}@{version}'

/**
 * Finds the projects of a workspace whose release tags are stranded under an old name.
 *
 * @remarks
 * Reads the repository's tags and every publishable manifest under `apps`, `libs` and `packages`.
 * Nothing is returned for a workspace with its own tag pattern, or one that is not a git repository.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param tagPattern - The `release.releaseTag.pattern` of `nx.json`, when it sets one.
 * @returns One entry per stranded project.
 * @throws Never - an unreadable repository has no tags to report.
 * @typeParam None - this function has no generic type parameters.
 */
export function locateStrandedReleaseTags (workspaceRoot: string, tagPattern?: string): StrandedReleaseTag[] {
  if (tagPattern !== undefined && tagPattern !== MNCI_TAG_PATTERN) {
    return []
  }
  const listed = runCapture('git', ['tag', '--list'], workspaceRoot)
  if (listed.status !== 0) {
    return []
  }
  const projects = globSync('{apps,libs,packages}/*/package.json', { cwd: workspaceRoot })
    .map(path => readJson<{ name?: string, private?: boolean }>(join(workspaceRoot, path)))
    .filter(manifest => manifest.private !== true && manifest.name !== undefined)
    .map(manifest => manifest.name as string)

  return findStrandedReleaseTags(projects, listed.stdout.split(/\r?\n/).filter(Boolean))
}
