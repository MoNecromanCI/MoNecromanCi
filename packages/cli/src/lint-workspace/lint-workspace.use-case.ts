import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCapture, runShell } from '../nx-workspace'
import { logger } from '../terminal'
import { planLint, runLintPlan, type LintProcesses } from './lint-together.use-case'

/**
 * Flags of `mnci lint`.
 *
 * @remarks
 * With neither, every project is linted.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface LintOptions {
  /** Lint only the projects affected since the base. */
  affected?: boolean
  /** The ref `--affected` compares with; the workspace's default base when absent. */
  base?:     string
}

/**
 * The branch `nx affected` compares with by default.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns `affected.defaultBase` or `defaultBase` from `nx.json`, otherwise `main`.
 * @throws Never - an unreadable `nx.json` reads as `main`.
 * @typeParam None - this function has no generic type parameters.
 */
function defaultBase (workspaceRoot: string): string {
  try {
    const nx = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as { affected?: { defaultBase?: unknown }, defaultBase?: unknown }
    const base = nx.affected?.defaultBase ?? nx.defaultBase

    return typeof base === 'string' ? base : 'main'
  } catch {
    return 'main'
  }
}

/**
 * Lints every project of the workspace, the npm ones in a single ESLint process.
 *
 * @remarks
 * ESLint pays a fixed cost to load its configuration on every start, so 24 per-project runs spent most of their time
 * starting (measured: about 4 s each, against 30 s for all 448 files in one process). This runs them together, and leaves
 * the projects of other languages, and the root files, to Nx. Where Nx's project names cannot be matched with what is on
 * disk it lints through Nx exactly as `nx run-many -t lint` does. The per-project run stays available as that command.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param options - The command's flags.
 * @param processes - The process runner; the real one by default.
 * @returns The exit status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
export function lintWorkspace (
  workspaceRoot: string,
  options: LintOptions,
  processes?: LintProcesses,
): number {
  const runner: LintProcesses = processes ?? {
    run:     (command, arguments_) => runShell(command, arguments_, workspaceRoot),
    capture: (command, arguments_) => runCapture(command, arguments_, workspaceRoot),
  }
  const affected = options.affected === true || options.base !== undefined
  const base = affected ? options.base ?? defaultBase(workspaceRoot) : undefined
  const plan = planLint(workspaceRoot, runner, base === undefined ? {} : { base })
  if (plan === undefined) {
    logger.info('Linting through Nx, project by project: this workspace has no npm projects, or Nx names could not be matched.')

    return runner.run('npx', base === undefined ? ['nx', 'run-many', '-t', 'lint'] : ['nx', 'affected', '-t', 'lint', `--base=${base}`])
  }

  return runLintPlan(plan, runner, message => { logger.info(message) })
}
