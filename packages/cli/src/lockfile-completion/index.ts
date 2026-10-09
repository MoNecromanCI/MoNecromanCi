/**
 * Having the pinned npm complete a lockfile an older npm wrote (#295).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { completeLockfile } from './complete-lockfile.use-case'
