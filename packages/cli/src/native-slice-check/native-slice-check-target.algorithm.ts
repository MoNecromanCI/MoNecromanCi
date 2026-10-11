/**
 * The `slice-check` target of a Rust or C++ project: the file-role check over its `src/`.
 *
 * @remarks
 * Cached, keyed on the project's sources and on the script itself, so it re-runs when either changes. The project's `lint`
 * depends on it, so the check runs wherever `lint` does, CI verify included.
 *
 * @param language - Which language's rules apply.
 * @param projectRoot - Workspace-relative project directory, e.g. `apps/hello`.
 * @returns The `nx:run-commands` target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function nativeSliceCheckTarget (language: 'rust' | 'cpp' | 'java' | 'php', projectRoot: string): Record<string, unknown> {
  return {
    executor: 'nx:run-commands',
    cache:    true,
    inputs:   ['{projectRoot}/src/**/*', '{projectRoot}/pom.xml', '{workspaceRoot}/tools/slice-check.cjs'],
    options:  { command: `node tools/slice-check.cjs ${language} ${projectRoot}` },
  }
}
