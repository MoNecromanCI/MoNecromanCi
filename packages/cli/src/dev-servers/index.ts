/**
 * Starting several projects together (`mnci dev`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { runDev, type DevOptions } from './run-dev.use-case'
