/**
 * What the CLI can do, described for tools that build their own UI from it.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export * from './command-description.contract'
export * from './describe-commands.algorithm'
export * from './list-commands.use-case'
