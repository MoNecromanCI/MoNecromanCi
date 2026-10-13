/**
 * What is known of a project without asking Nx, enough to tell whether ESLint lints it.
 *
 * @remarks
 * Read from the project's `package.json` and `project.json` by `locateEslintProjects`.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ProjectLintFacts {
  /** Whether the project folder has a `package.json`, which is what makes it an npm project. */
  readonly hasPackageJson: boolean
  /** The text of the project's explicit `lint` target (its executor and command), or `undefined` when it has none. */
  readonly lintTarget:     string | undefined
}

/**
 * Whether ESLint is what lints a project.
 *
 * @remarks
 * An npm project is linted by ESLint unless its own `lint` target says otherwise (`astro check`, a framework's linter): a
 * missing explicit target is the plugin-inferred `eslint .`. Projects of the other languages have no `package.json` (they
 * are linted by `golangci-lint`, `ruff`, `clippy` and so on) and stay with Nx.
 *
 * @param facts - What is known of the project.
 * @returns `true` when the project can be linted in the one ESLint process with the others.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isEslintLinted (facts: ProjectLintFacts): boolean {
  return facts.hasPackageJson && (facts.lintTarget === undefined || /eslint/i.test(facts.lintTarget))
}

/**
 * Splits folders into command lines that each stay under a length.
 *
 * @remarks
 * A shell has a limit on a command line (8191 characters on Windows), and a workspace can have more projects than that
 * holds. Chunks keep the one-process-per-chunk count far below one per project.
 *
 * @param directories - The project folders.
 * @param limit - The most characters of folders one invocation may carry.
 * @returns The folders in order, in groups that each fit.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function chunkDirectories (directories: readonly string[], limit: number): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let length = 0
  for (const directory of directories) {
    if (current.length > 0 && length + directory.length + 1 > limit) {
      chunks.push(current)
      current = []
      length = 0
    }
    current.push(directory)
    length += directory.length + 1
  }
  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}
