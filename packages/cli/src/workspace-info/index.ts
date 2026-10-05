/**
 * What is installed and what is in the workspace, for people and for editors (`mnci info`, `mnci projects`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export * from './list-projects.use-case'
export * from './project-summary.contract'
export * from './read-workspace-info.use-case'
