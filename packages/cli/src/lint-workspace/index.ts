/**
 * Linting every project of a workspace with one ESLint process instead of one per project.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { lintWorkspace, type LintOptions } from './lint-workspace.use-case'
export { planLint, runLintPlan, type LintPlan, type LintProcesses } from './lint-together.use-case'
