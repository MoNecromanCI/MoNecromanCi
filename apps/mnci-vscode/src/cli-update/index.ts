/**
 * Updating the mnci CLI the extension uses.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { updateCli, type UpdateSurface } from './update-cli.use-case'
