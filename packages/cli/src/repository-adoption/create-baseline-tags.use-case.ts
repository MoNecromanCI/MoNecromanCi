import { runCapture } from '../nx-workspace'
import type { StrandedReleaseTag } from '../workspace-diagnostics'

/**
 * What {@link createBaselineTags} did.
 *
 * @remarks
 * `created` and `existing` hold the new tag names; `failed` holds the ones git refused, with its reason unknown
 * because git's own message is not captured.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface BaselineTagsResult {
  /** Tags created, on the commit of the old tag. */
  created:  string[]
  /** Tags that already existed and were left alone. */
  existing: string[]
  /** Tags git could not create, usually because the old tag no longer resolves. */
  failed:   string[]
}

/**
 * Creates, locally, the tag each stranded project's next release will resolve from.
 *
 * @remarks
 * Each new tag points at the commit of the old tag with the same version, so `nx release` finds the
 * project's last release under its current name and continues from it instead of from the disk version.
 * Lightweight tags, because that is all `nx release` reads. A tag that already exists is never moved.
 * Nothing is pushed: publishing tags changes the remote and is a separate, confirmed step.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param stranded - The projects to baseline, from `locateStrandedReleaseTags`.
 * @returns What was created, what was already there and what git refused.
 * @throws Never - a refused tag is reported in `failed`.
 * @typeParam None - this function has no generic type parameters.
 */
export function createBaselineTags (repositoryRoot: string, stranded: readonly StrandedReleaseTag[]): BaselineTagsResult {
  const result: BaselineTagsResult = { created: [], existing: [], failed: [] }
  for (const entry of stranded) {
    const present = runCapture('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${entry.newTag}`], repositoryRoot)
    if (present.status === 0) {
      result.existing.push(entry.newTag)
      continue
    }
    const made = runCapture('git', ['tag', entry.newTag, `${entry.oldTag}^{commit}`], repositoryRoot)
    ;(made.status === 0 ? result.created : result.failed).push(entry.newTag)
  }

  return result
}
