import { globSync } from 'node:fs'

/** The folders a project lives in. */
const PROJECT_ROOTS = ['apps', 'packages', 'libs']

/**
 * Whether the workspace holds a project that has the given manifest.
 *
 * @remarks
 * Looks one level down in `apps`, `packages` and `libs`, where every kind puts its projects; a manifest deeper than that
 * (a vendored dependency, a template) never counts.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param manifest - The file name that marks the project (`composer.json`, `Gemfile`, `CMakeLists.txt`).
 * @returns True when at least one project folder has it.
 * @throws Never - an unreadable folder holds none.
 * @typeParam None - this function has no generic type parameters.
 */
export function hasProjectManifest (workspaceRoot: string, manifest: string): boolean {
  return PROJECT_ROOTS.some(root => globSync(`${root}/*/${manifest}`, { cwd: workspaceRoot }).length > 0)
}
