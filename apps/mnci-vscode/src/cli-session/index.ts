/**
 * The CLI's answers, cached and shared by every view of the extension.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { CliSession, type CliSessionDependencies } from './cli-session.store'
