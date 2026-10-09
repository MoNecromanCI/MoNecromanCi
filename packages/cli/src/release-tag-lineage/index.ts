/**
 * Keeping a project's release history reachable when its name changes (`nx release` looks a project's last release up
 * by its current name).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { createBaselineTags, type BaselineTagsResult } from './create-baseline-tags.use-case'
export { locateStrandedReleaseTags } from './locate-stranded-release-tags.use-case'
export { locateTagsBehindRegistry } from './locate-tags-behind-registry.use-case'
export { locateRegistryVersions } from './locate-registry-versions.use-case'
export { findStrandedReleaseTags, latestTaggedVersions, tagsBehindRegistry, versionsBehindRegistry, type StrandedReleaseTag, type TagBehindRegistry } from './stranded-release-tags.algorithm'
