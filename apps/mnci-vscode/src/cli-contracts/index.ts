/**
 * The shapes of what the mnci CLI prints with `--json`, as the extension reads them.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export type * from './command-description.contract'
export type * from './workspace-report.contract'
