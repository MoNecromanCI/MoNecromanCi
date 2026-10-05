/**
 * Adding a dependency to one project (`mnci install`), converging declared ranges (`mnci sync`) and updating them (`mnci up`) across every ecosystem.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export * from './install-dependencies.use-case'
export * from './sync-dependencies.use-case'
export * from './update-dependencies.use-case'
export { ECOSYSTEMS, locateProjects, type Ecosystem, type ProjectLocation } from './manifest.repository'
