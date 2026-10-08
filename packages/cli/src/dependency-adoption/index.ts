/**
 * Moving a repository's root runtime dependencies into the projects that import them.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { adoptDependencies, type DependenciesDependencies, type DependenciesResult } from './adopt-dependencies.use-case'
