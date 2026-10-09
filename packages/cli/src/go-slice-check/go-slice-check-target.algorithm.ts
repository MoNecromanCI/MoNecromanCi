/**
 * The `slice-check` target of a Go project: the file-role check over its directory.
 *
 * @remarks
 * Cached, keyed on the project's Go files and on the script itself, so it re-runs when either changes. The project's `lint`
 * depends on it, so the check runs wherever `lint` does, CI verify included.
 *
 * @param projectRoot - Workspace-relative project directory, e.g. `apps/api`.
 * @returns The `nx:run-commands` target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function goSliceCheckTarget (projectRoot: string): Record<string, unknown> {
  return {
    executor: 'nx:run-commands',
    cache:    true,
    inputs:   ['{projectRoot}/**/*.go', '{workspaceRoot}/tools/go-slice-check.cjs'],
    options:  { command: `node tools/go-slice-check.cjs ${projectRoot}` },
  }
}
