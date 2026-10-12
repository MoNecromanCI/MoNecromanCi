import type { Ecosystem } from './manifest.repository'
import type { UpdateKind } from './semver.algorithm'

/**
 * One available update, as `mnci up --json` prints it.
 *
 * @remarks
 * `link` is absent for an ecosystem with no registry page; every other field is always present.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdateReportEntry {
  /** The package name. */
  name:      string
  /** Which ecosystem it belongs to. */
  ecosystem: Ecosystem
  /** `patch`, `minor`, `major` or `non-semver`. */
  kind:      UpdateKind
  /** The version in use. */
  current:   string
  /** The newest published version. */
  latest:    string
  /** The registry page of the new version, when the ecosystem has one. */
  link?:     string
  /** Every project that declares the package (`(root)` for the workspace root). */
  projects:  string[]
  /** How it is declared there: `dep`, `devDep`, `peerDep`, … */
  sections:  string[]
}

/**
 * The document `mnci up --json` prints: every package with a newer release, in report order.
 *
 * @remarks
 * An editor reads this instead of the terminal report, so its shape is a contract: add fields, never rename one.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdateReport {
  /** The available updates. */
  updates: UpdateReportEntry[]
}
