/**
 * Turning a generated CommonJS Node app into an ES module app (`mnci add --esm`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { convertAppToEsm } from './esm-conversion.use-case'
