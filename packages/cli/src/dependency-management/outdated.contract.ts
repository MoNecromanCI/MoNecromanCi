import type { DependencySite, Ecosystem } from './manifest.repository'
import type { UpdateKind } from './semver.algorithm'

/**
 * One package with a newer release available.
 *
 * @remarks
 * `current` is one version even though `sites` may declare several ranges: it
 * is what the workspace actually resolved, which is the only version an upgrade
 * is meaningfully measured from. A workspace whose sites genuinely disagree is
 * `mnci sync`'s problem, not this command's.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface Outdated {
  /** The package name. */
  name:      string
  /** Which ecosystem it belongs to. */
  ecosystem: Ecosystem
  /** The version currently in use. */
  current:   string
  /** The newest published version. */
  latest:    string
  /** Which `npm-check` section this upgrade belongs in. */
  kind:      UpdateKind
  /** Every place it is declared — the column `npm-check` does not have. */
  sites:     DependencySite[]
}
