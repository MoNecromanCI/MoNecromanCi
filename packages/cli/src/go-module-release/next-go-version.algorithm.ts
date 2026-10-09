/**
 * One commit, as far as a version decision cares: its subject line and body.
 *
 * @remarks
 * The body matters only for a `BREAKING CHANGE:` footer.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ReleaseCommit {
  readonly subject: string
  readonly body?:   string
}

/**
 * How far a release moves the version.
 *
 * @remarks
 * What a set of commits asks for; before 1.0.0 the major is never moved (see {@link releaseBump}).
 * @typeParam None - this type has no generic type parameters.
 */
export type VersionBump = 'major' | 'minor' | 'patch'

/**
 * A semantic version as `[major, minor, patch]`.
 *
 * @remarks
 * Plain versions only: a pre-release suffix is not a version of a module (see {@link parseVersionTag}).
 * @typeParam None - this type has no generic type parameters.
 */
export type VersionParts = readonly [number, number, number]

/**
 * The tag to create, and why.
 *
 * @remarks
 * `first` marks a module that had no tag at all, which has nothing to compare its commits with.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface NextTag {
  readonly tag:  string
  /** The bump the commits asked for, or `first` for a module with no tag yet. */
  readonly bump: VersionBump | 'first'
}

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const CONVENTIONAL_SUBJECT = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?: /
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m
const ORDER: readonly VersionBump[] = ['patch', 'minor', 'major']

/**
 * The version a tag names, for a module whose tags start with `prefix`.
 *
 * @remarks
 * A Go module in a sub-directory is versioned by tags named `<directory>/vX.Y.Z`, so `packages/tty/v1.2.3` with the
 * prefix `packages/tty/` is `[1, 2, 3]`. Pre-release suffixes and tags of other modules are not versions of this one.
 *
 * @param tag - A git tag.
 * @param prefix - The module's tag prefix, including the trailing slash.
 * @returns The version, or `undefined` when the tag is not a plain version of this module.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function parseVersionTag (tag: string, prefix: string): VersionParts | undefined {
  if (!tag.startsWith(prefix)) {
    return undefined
  }
  const match = SEMVER_TAG.exec(tag.slice(prefix.length))

  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Orders two versions.
 *
 * @param left - A version.
 * @param right - Another version.
 * @returns Negative when `left` is lower, positive when higher, zero when equal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function compareVersions (left: VersionParts, right: VersionParts): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

/**
 * The highest version among the tags that belong to a module.
 *
 * @remarks
 * Compared as numbers, so `v0.10.0` is above `v0.9.0`.
 *
 * @param tags - Tags to look through, of any module.
 * @param prefix - The module's tag prefix, including the trailing slash.
 * @returns The highest version, or `undefined` when the module has no tag yet.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function latestVersion (tags: readonly string[], prefix: string): VersionParts | undefined {
  const versions = tags.map(tag => parseVersionTag(tag, prefix)).filter((version): version is VersionParts => version !== undefined)

  return versions.toSorted(compareVersions).at(-1)
}

/**
 * What one commit asks for, before the pre-1.0 adjustment.
 *
 * @param commit - A commit.
 * @returns A bump, or `undefined` for a commit that does not release (docs, chore, test, ci, refactor, build, style).
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function bumpOf (commit: ReleaseCommit): VersionBump | undefined {
  const match = CONVENTIONAL_SUBJECT.exec(commit.subject)
  if (match?.groups === undefined) {
    return undefined
  }
  if (match.groups.breaking === '!' || BREAKING_FOOTER.test(commit.body ?? '')) {
    return 'major'
  }
  if (match.groups.type === 'feat') {
    return 'minor'
  }

  return match.groups.type === 'fix' || match.groups.type === 'perf' ? 'patch' : undefined
}

/**
 * The bump a set of commits calls for, given the module's current major version.
 *
 * @remarks
 * The rules match how `nx release` versions the npm packages. From 1.0.0 a breaking change is major, a `feat` is
 * minor, and a `fix` or `perf` is patch. Before 1.0.0 nothing moves the major: a `feat` and a `fix` are both a
 * patch, and a breaking change is a minor.
 *
 * @param commits - The commits since the module's latest tag.
 * @param major - The module's current major version.
 * @returns The bump, or `undefined` when none of the commits releases.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function releaseBump (commits: readonly ReleaseCommit[], major: number): VersionBump | undefined {
  const asked = commits.map(commit => bumpOf(commit)).filter((bump): bump is VersionBump => bump !== undefined)
  if (asked.length === 0) {
    return undefined
  }
  const highest = asked.reduce((best, bump) => (ORDER.indexOf(bump) > ORDER.indexOf(best) ? bump : best))
  if (major > 0) {
    return highest
  }

  return highest === 'major' ? 'minor' : 'patch'
}

/**
 * Applies a bump to a version.
 *
 * @remarks
 * Everything after the part that moves is reset to zero.
 *
 * @param version - The current version.
 * @param bump - How far to move it.
 * @returns The new version.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function bumpVersion (version: VersionParts, bump: VersionBump): VersionParts {
  const [major, minor, patch] = version
  if (bump === 'major') {
    return [major + 1, 0, 0]
  }

  return bump === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1]
}

/**
 * Decides the tag to create for a module, or none.
 *
 * @remarks
 * Pure: no git and no clock. A module with no tag yet is released as `v0.0.1` as soon as it has any commit,
 * whatever the commit says, because there is nothing to compare with.
 *
 * @param input - The module's existing tags, the commits that touched it since its latest tag (all of them when
 * it has none), and its tag prefix (`<directory>/`).
 * @returns The tag and the bump behind it, or `undefined` when nothing releases.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function nextTag (input: { tags: readonly string[], commits: readonly ReleaseCommit[], prefix: string }): NextTag | undefined {
  const current = latestVersion(input.tags, input.prefix)
  if (current === undefined) {
    return input.commits.length === 0 ? undefined : { tag: `${input.prefix}v0.0.1`, bump: 'first' }
  }
  const bump = releaseBump(input.commits, current[0])

  return bump === undefined ? undefined : { tag: `${input.prefix}v${bumpVersion(current, bump).join('.')}`, bump }
}
