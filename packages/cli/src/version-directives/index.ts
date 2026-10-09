/**
 * Forcing the release version of a project from a commit message (#283).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { locateVersionDirectives } from './locate-version-directives.use-case'
export { newestTaggedVersion, parseVersionDirective, pickVersionDirectives, VERSION_DIRECTIVE_TYPES, type VersionDirective } from './version-directive.algorithm'
