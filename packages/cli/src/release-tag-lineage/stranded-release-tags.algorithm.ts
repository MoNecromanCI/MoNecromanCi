/**
 * A project whose release tags exist only under a name it no longer has.
 *
 * @remarks
 * See {@link findStrandedReleaseTags}.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface StrandedReleaseTag {
  /** The project's current name, which `nx release` looks its tags up by. */
  project: string
  /** The newest tag under the old, unscoped name. */
  oldTag:  string
  /** The tag to create on the same commit so the next release resolves from it. */
  newTag:  string
}

/**
 * Compares two versions written `major.minor.patch`.
 *
 * @param left - The first version.
 * @param right - The second version.
 * @returns Negative when `left` is older, positive when newer, 0 when equal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function compareVersions (left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)

  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || 0
}

/**
 * The plain versions a project has been tagged with.
 *
 * @param tags - Every tag of the repository.
 * @param name - The name the tags are written under.
 * @returns The `major.minor.patch` versions of the tags `<name>@<version>`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function versionsOf (tags: readonly string[], name: string): string[] {
  return tags
    .filter(tag => tag.startsWith(`${name}@`))
    .map(tag => tag.slice(name.length + 1))
    .filter(version => /^\d+\.\d+\.\d+$/.test(version))
}

/**
 * Finds the projects `nx release` would restart from the disk version.
 *
 * @remarks
 * `nx release` looks a project's last release up by `<project name>@<version>`. A project renamed to
 * a scoped name (`@auto/ms.teams`) while its tags still read `ms.teams@1.12.11` has no tag under the
 * new name, so the version resolves from `package.json`, usually the scaffold's `0.0.1`, and the
 * release publishes a version far below the real one. Only a scoped name is checked: the old tag is
 * the same name without its scope.
 *
 * @param projects - Current project names.
 * @param tags - Every tag of the repository.
 * @returns One entry per project whose newest version tag under the unscoped name is newer than any under its own name.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function findStrandedReleaseTags (projects: readonly string[], tags: readonly string[]): StrandedReleaseTag[] {
  const stranded: StrandedReleaseTag[] = []
  for (const project of projects) {
    const unscoped = /^@[^/]+\/(.+)$/.exec(project)?.[1]
    if (unscoped === undefined) {
      continue
    }
    const current = versionsOf(tags, project).sort(compareVersions).at(-1)
    const newest = versionsOf(tags, unscoped).sort(compareVersions).at(-1)
    if (newest !== undefined && (current === undefined || compareVersions(newest, current) > 0)) {
      stranded.push({ project, oldTag: `${unscoped}@${newest}`, newTag: `${project}@${newest}` })
    }
  }

  return stranded
}
