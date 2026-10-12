/**
 * How big a step an update is.
 *
 * @remarks
 * Mirrors `UpdateKind` in the CLI's `dependency-management` slice.
 * @typeParam None - this type has no generic type parameters.
 */
export type UpdateKind = 'patch' | 'minor' | 'major' | 'non-semver'

/**
 * One package with a newer release.
 *
 * @remarks
 * Mirrors the CLI's `mnci up --json`. `link` is the registry page of the new version and is
 * absent for an ecosystem with no such page.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdateDescription {
  readonly name:      string
  readonly ecosystem: string
  readonly kind:      UpdateKind
  readonly current:   string
  readonly latest:    string
  readonly link?:     string
  readonly projects:  readonly string[]
  readonly sections:  readonly string[]
}

/**
 * The document `mnci up --json` prints.
 *
 * @remarks
 * In report order: patch, minor, major, non-semver, then by name.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdateReport {
  readonly updates: readonly UpdateDescription[]
}
