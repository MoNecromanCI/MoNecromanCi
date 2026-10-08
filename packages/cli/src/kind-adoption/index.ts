/**
 * Recording the mnci kind of every existing project as a type tag.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { adoptKinds, type KindOutcome, type KindsDependencies } from './adopt-kinds.use-case'
