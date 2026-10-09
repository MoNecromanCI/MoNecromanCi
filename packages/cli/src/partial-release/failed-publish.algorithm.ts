/**
 * What a failed release leaves to decide: which of the tags it made may be published.
 *
 * @remarks
 * The two lists partition the tags the run made.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface SurvivingTags {
  /** Tags whose package was not among the failures, safe to push. */
  push: string[]
  /** Tags held back, each naming the failed project it belongs to. */
  held: string[]
}

// eslint-disable-next-line no-control-regex -- the escape character that starts a colour code
const ANSI = /\u{1B}\[[0-9;]*m/gu
const FAILED_TASK = /^\s*-\s+(\S+):nx-release-publish\s*$/
/** A tag that names its project: `<project>@<semver>`, `nx release`'s default independent pattern. */
const PROJECT_TAG = /^(.+)@\d+\.\d+\.\d\S*$/

/**
 * The projects whose `nx-release-publish` task failed, read from `nx`'s "Failed tasks" list.
 *
 * @remarks
 * Colour codes are stripped first, since `nx` colours the list when it writes to a terminal.
 *
 * @param output - The combined output of the failed `nx release`.
 * @returns The project names, in the order `nx` listed them; empty when no publish task failed.
 * @throws Never - unmatched text yields an empty list.
 * @typeParam None - this function has no generic type parameters.
 */
export function failedPublishProjects (output: string): string[] {
  return output
    .replaceAll(ANSI, '')
    .split(/\r?\n/)
    .map(line => FAILED_TASK.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)
}

/**
 * Splits the tags a failed release made into those safe to push and those to hold back.
 *
 * @remarks
 * `nx release` tags every project, then publishes; a publish failure leaves tags for packages that
 * never reached the registry. Pushing them all strands those versions, pushing none strands every
 * package that DID publish (the next run proposes the same version again and the registry refuses
 * it). So a tag goes out unless it belongs to a project that failed. A tag that does not name its
 * project (a shared `v1.2.3`) cannot be attributed, so with such a tag present nothing is pushed.
 *
 * @param tags - The tags the failed run created.
 * @param failed - The projects whose publish failed.
 * @returns The tags to push and the ones held back.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function survivingTags (tags: string[], failed: string[]): SurvivingTags {
  if (failed.length === 0 || tags.some(tag => !PROJECT_TAG.test(tag))) {
    return { push: [], held: tags }
  }
  const held = tags.filter(tag => failed.includes(PROJECT_TAG.exec(tag)?.[1] ?? ''))

  return { push: tags.filter(tag => !held.includes(tag)), held }
}
