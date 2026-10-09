/**
 * Keeping git true to the registry after a release that failed part way.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only through this barrel.
 */

export { pushSurvivingTags, type TagPushProcesses } from './push-surviving-tags.use-case'
