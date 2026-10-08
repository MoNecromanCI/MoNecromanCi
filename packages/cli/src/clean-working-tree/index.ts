/**
 * The git precondition every step that changes files shares: the work tree is clean.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { requireCleanWorkingTree } from './clean-working-tree.validator'
