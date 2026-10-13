import { chunkDirectories } from './eslint-project.algorithm'
import { locateEslintProjects, type EslintProject } from './locate-eslint-projects.use-case'

/**
 * The processes a lint run starts.
 *
 * @remarks
 * Structurally what `CiProcesses` is, declared here so this slice depends on nothing above it: the verify phase hands its
 * own runner in.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface LintProcesses {
  run:     (command: string, arguments_: string[]) => number
  capture: (command: string, arguments_: string[]) => { status: number, stdout: string }
}

/**
 * What to lint, split by who lints it.
 *
 * @remarks
 * `eslint` is the npm projects, linted in one ESLint process; `nx` is every other project that has a `lint` target (Go,
 * Python, Rust and the rest, each with its own tool, and the workspace root), left to Nx.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface LintPlan {
  readonly eslint: readonly EslintProject[]
  readonly nx:     readonly string[]
}

/** The most characters of folders one ESLint command line carries; Windows stops at 8191 for the whole line. */
const COMMAND_LINE_LIMIT = 6000

/**
 * Reads the project names Nx reports for a `show projects` query.
 *
 * @param processes - The process runner.
 * @param extra - The flags after `--with-target lint --json`.
 * @returns The names, or `undefined` when Nx could not answer or did not answer with a list.
 * @throws Never - an unreadable answer is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
function showProjects (processes: LintProcesses, extra: readonly string[]): string[] | undefined {
  const result = processes.capture('npx', ['nx', 'show', 'projects', '--with-target', 'lint', '--json', ...extra])
  if (result.status !== 0) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout)

    return Array.isArray(parsed) && parsed.every(entry => typeof entry === 'string') ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Works out which projects one ESLint process lints and which Nx lints.
 *
 * @remarks
 * Never guesses: every ESLint project found on disk must be a project Nx knows under that name, or the plan is `undefined`
 * and the caller lints through Nx exactly as before, because a name that does not match would silently drop a project from
 * the lint. With a `base` it is affected-scoped, and the two lists are what changed since it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param options - `base` scopes it to the projects affected since that ref; `exclude` leaves out Nx patterns (`tag:...`).
 * @returns The plan, or `undefined` when there is nothing to lint together or Nx's answer cannot be matched.
 * @throws Never - a failing command is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
export function planLint (
  workspaceRoot: string,
  processes: LintProcesses,
  options: { readonly base?: string, readonly exclude?: readonly string[] } = {},
): LintPlan | undefined {
  const eslint = locateEslintProjects(workspaceRoot)
  if (eslint.length === 0) {
    return undefined
  }
  const exclude = (options.exclude ?? []).map(pattern => `--exclude=${pattern}`)
  const known = showProjects(processes, exclude)
  if (known === undefined || eslint.some(project => !known.includes(project.name))) {
    return undefined
  }
  const scoped = options.base === undefined ? known : showProjects(processes, ['--affected', `--base=${options.base}`, ...exclude])
  if (scoped === undefined) {
    return undefined
  }
  const eslintNames = new Set(eslint.map(project => project.name))

  return {
    eslint: eslint.filter(project => scoped.includes(project.name)),
    nx:     scoped.filter(name => !eslintNames.has(name)),
  }
}

/**
 * Runs a lint plan: one ESLint process over the npm projects, then Nx over the rest.
 *
 * @remarks
 * Both always run, so one failure does not hide the other's findings, and the first failing status is returned. ESLint's
 * own `--cache` stands in for the per-project Nx cache; the folders are passed explicitly, never `apps libs packages`,
 * which would also lint the Markdown and JSON of the Go and Python projects that their own tools lint.
 *
 * @param plan - What to lint.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0 when everything was clean, otherwise the first failing status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
export function runLintPlan (plan: LintPlan, processes: LintProcesses, log: (message: string) => void): number {
  let status = 0
  const directories = plan.eslint.map(project => project.dir)
  if (directories.length > 0) {
    log(`Linting ${plan.eslint.length} npm project(s) in one ESLint process.`)
    for (const chunk of chunkDirectories(directories, COMMAND_LINE_LIMIT)) {
      const result = processes.run('npx', ['eslint', ...chunk, '--cache'])
      status = status === 0 ? result : status
    }
  }
  if (plan.nx.length > 0) {
    log(`Linting ${plan.nx.length} project(s) with their own linters.`)
    const result = processes.run('npx', ['nx', 'run-many', '-t', 'lint', `--projects=${plan.nx.join(',')}`])
    status = status === 0 ? result : status
  }

  return status
}
