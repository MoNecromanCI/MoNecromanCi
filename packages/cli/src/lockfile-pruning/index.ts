/**
 * Removing what the lockfile keeps after the manifest stopped asking for it.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only through this barrel.
 */

export { pruneStaleLocalRegistry } from './prune-stale-local-registry.use-case'
export type { PruneResult } from './prune-stale-local-registry.use-case'
export { hasStaleLocalRegistry } from './stale-local-registry.validator'
