/**
 * Where the mnci CLI was found, and how to start it.
 *
 * @remarks
 * `command` plus `prefix` is the start of every invocation; the caller appends the mnci
 * arguments. `source` says why this one was chosen, which the update panel shows.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CliLocation {
  /** The executable to start (a path, or a name resolved on `PATH`). */
  readonly command: string
  /** Arguments that come before mnci's own (`--yes @mnci/cli` for npx). */
  readonly prefix:  readonly string[]
  /** `setting`: `mnci.cliPath`. `workspace`: the workspace's own install. `path`: a global install. `npx`: fetched on demand. */
  readonly source:  'setting' | 'workspace' | 'path' | 'npx'
}
