import type { CliSession } from '../cli-session'
import type { Prompter } from '../invocation'

/** Targets worth offering even when a project's `project.json` does not list them: Nx infers these for most kinds. */
const COMMON_TARGETS: readonly string[] = ['build', 'test', 'lint', 'typecheck', 'start', 'dev', 'package']

/**
 * What running a target needs from the outside.
 *
 * @remarks
 * `run` starts a command line in a terminal.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RunTargetDependencies {
  readonly session:  CliSession
  readonly prompter: Prompter
  readonly run:      (command: string, arguments_: readonly string[], cwd: string | undefined) => void
}

/**
 * Runs `nx run <project>:<target>` in a terminal, asking for whichever part is not given.
 *
 * @remarks
 * Clicking a target in the projects view passes both. From the palette or a project's context
 * menu, the missing parts are picked: the project from the workspace, the target from that
 * project's own targets plus the ones Nx usually infers. Nx is the one that says so if a
 * target does not exist for the project.
 *
 * @param dependencies - The session, the prompter and the terminal runner.
 * @param project - The project name, when the caller knows it.
 * @param target - The target name, when the caller knows it.
 * @returns Nothing; cancelling at any question does nothing.
 * @throws Error when the workspace has no projects.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runTarget (dependencies: RunTargetDependencies, project?: string, target?: string): Promise<void> {
  const { session, prompter, run } = dependencies
  const projects = await session.projects()
  let projectName = project
  if (projectName === undefined) {
    if (projects.length === 0) {
      throw new Error('This workspace has no projects to run a target of.')
    }
    projectName = await prompter.pickOne(
      projects.map(candidate => ({ label: candidate.name, value: candidate.name, description: candidate.dir })),
      'Run a target of which project?',
    )
    if (projectName === undefined) {
      return
    }
  }
  let targetName = target
  if (targetName === undefined) {
    const own = projects.find(candidate => candidate.name === projectName)?.targets ?? []
    const names = [...new Set([...own, ...COMMON_TARGETS])]
    targetName = await prompter.pickOne(names.map(name => ({ label: name, value: name, description: own.includes(name) ? 'defined by mnci' : 'usually inferred' })), `Run which target of ${projectName}?`)
    if (targetName === undefined) {
      return
    }
  }

  run('npx', ['nx', 'run', `${projectName}:${targetName}`], session.workspaceRoot)
}
