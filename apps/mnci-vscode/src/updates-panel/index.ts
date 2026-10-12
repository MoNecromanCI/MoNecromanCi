/**
 * The dependency updates panel: `mnci up --json` shown as a page where packages are chosen.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { openUpdatesPanel, type UpdatesPanelDependencies, type UpdatesSurface } from './open-updates-panel.use-case'
export { showUpdatesPanel } from './updates-panel.client'
