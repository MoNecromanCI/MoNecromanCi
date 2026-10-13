/**
 * `mnci release` and `mnci release --dry-run`: the release a CI run makes, from a developer machine, after the checks that
 * keep it from proposing a version that is already published.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { releaseWorkspace, type ReleaseOptions } from './release-workspace.use-case'
