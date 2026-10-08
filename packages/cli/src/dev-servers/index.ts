/**
 * Starting several projects together (`mnci dev`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export * from './run-dev.use-case'
export { listStartableProjects } from './startable-projects.use-case'
