/**
 * Bringing an existing repository under mnci, step by step (`mnci adopt`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { runAdopt, type AdoptOptions } from './run-adopt.use-case'
