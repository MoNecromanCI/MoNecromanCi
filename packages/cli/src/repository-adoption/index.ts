/**
 * Bringing an existing repository under mnci (`mnci adopt`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below. Report mode only so far (#377).
 */

export * from './adoption-report.contract'
export * from './run-adopt.use-case'
