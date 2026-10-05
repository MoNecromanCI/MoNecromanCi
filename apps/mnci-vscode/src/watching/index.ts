/**
 * Noticing when the workspace's projects change.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { watchWorkspace } from './watch-workspace.handler'
