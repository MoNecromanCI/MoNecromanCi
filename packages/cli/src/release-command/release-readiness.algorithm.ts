import type { StrandedReleaseTag, TagBehindRegistry, UntaggedPublished } from '../release-tag-lineage'

/**
 * What a release looks at before versioning anything.
 *
 * @remarks
 * Each list is one way a project's last release goes missing; the branch and the fetch say how far to trust them.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ReleaseFindings {
  /** Projects whose tags sit under an old unscoped name. */
  readonly stranded:    readonly StrandedReleaseTag[]
  /** Projects whose registry is ahead of their newest tag. */
  readonly behind:      readonly TagBehindRegistry[]
  /** Published projects with no tag under any name. */
  readonly untagged:    readonly UntaggedPublished[]
  /** The current branch, or `undefined` when it could not be read (detached, no git). */
  readonly branch:      string | undefined
  /** Whether `git fetch --tags` worked: without it every finding above is as old as the clone. */
  readonly tagsFetched: boolean
}

/**
 * What stops a release, and what only deserves a look.
 *
 * @remarks
 * Every entry is a sentence that names the command or the tag that clears it.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ReleaseReadiness {
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
}

/**
 * The branch CI releases from.
 *
 * @remarks
 * The same branch `isMainPush` reads, so a release made here and one made by CI are cut from the same line of commits.
 */
export const RELEASE_BRANCH = 'main'

/**
 * Decides whether a release can be trusted.
 *
 * @remarks
 * Every blocker is a case where `nx release` would resolve a project's last release wrongly and propose a version that is
 * already published or far below it, which a feed then refuses for good. A preview reports the branch as a warning because
 * seeing the plan from a branch is useful; a real release refuses it.
 *
 * @param findings - What was found.
 * @param dryRun - Whether nothing will be tagged or published.
 * @returns The blockers and the warnings, each naming the way out.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function assessRelease (findings: ReleaseFindings, dryRun: boolean): ReleaseReadiness {
  const blockers: string[] = []
  const warnings: string[] = []

  if (!findings.tagsFetched) {
    warnings.push('Could not fetch the release tags from the remote, so what follows is as old as this clone. Run `git fetch --tags` and try again.')
  }
  for (const entry of findings.stranded) {
    blockers.push(`${entry.project} has release tags only under ${entry.oldTag}: nx release would restart it from its disk version. Run \`mnci adopt --tags\` to create ${entry.newTag} locally.`)
  }
  for (const entry of findings.untagged) {
    blockers.push(`${entry.project} is published at ${entry.published} but has no release tag under any name: nx release would start it from its package.json version. Run \`git fetch --tags\`; if the tag really does not exist, create it on the commit that published ${entry.published} (\`git tag ${entry.project}@${entry.published} <commit>\`).`)
  }
  for (const entry of findings.behind) {
    blockers.push(`${entry.project} is tagged ${entry.tagged} but the registry already has ${entry.published}: the next release would propose a version the feed refuses. Tag the commit that published ${entry.published} as ${entry.project}@${entry.published}.`)
  }
  if (findings.branch !== undefined && findings.branch !== RELEASE_BRANCH) {
    const message = `You are on ${findings.branch}, and releases are made from ${RELEASE_BRANCH}: a tag made here points at commits ${RELEASE_BRANCH} may never get.`
    if (dryRun) {
      warnings.push(message)
    } else {
      blockers.push(message)
    }
  }

  return { blockers, warnings }
}
