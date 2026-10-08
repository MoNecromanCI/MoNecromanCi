import { checkbox } from '@inquirer/prompts'
import { logger } from '../terminal'
import { spawnProject, type RunningProject } from './spawn-project.client'
import { listStartableProjects, type StartableProject } from './startable-projects.use-case'

/**
 * Flags of `mnci dev`.
 *
 * @remarks
 * `all` starts every project that can be started; `dryRun` prints the commands and starts nothing.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DevOptions {
  /** Start every project that has a start command. */
  all?:    boolean
  /** Print what would run and stop. */
  dryRun?: boolean
}

/**
 * What {@link runDev} needs from its environment, so a test can run it without Nx, processes or a terminal.
 *
 * @remarks
 * Every member has a real default.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DevDependencies {
  /** Starts one project's command and reports its output a line at a time. */
  start:       (project: string, target: string, onLine: (line: string) => void) => RunningProject
  /** Asks which projects to start, when none were named. */
  choose:      (available: readonly string[]) => Promise<string[]>
  /** Whether a person can be asked. */
  interactive: boolean
  /** Prints one prefixed line of a project's output. */
  print:       (line: string) => void
}

/**
 * Asks which of the startable projects to run.
 *
 * @param available - The projects that have a start command.
 * @returns The ones picked.
 * @throws Propagates a prompt's failure.
 * @typeParam None - this function has no generic type parameters.
 */
async function chooseProjects (available: readonly string[]): Promise<string[]> {
  return await checkbox<string>({
    message:  'Which projects should start together?',
    choices:  available.map(name => ({ name, value: name })),
    required: true,
  })
}

/**
 * Picks the projects to start from what was named, `--all`, or a prompt.
 *
 * @param available - The startable projects.
 * @param named - The names given on the command line.
 * @param options - The command's flags.
 * @param dependencies - How to ask.
 * @returns The projects to start, with their targets.
 * @throws Error when a name is not startable, or none can be chosen.
 * @typeParam None - this function has no generic type parameters.
 */
async function selectProjects (available: readonly StartableProject[], named: readonly string[], options: DevOptions, dependencies: Partial<DevDependencies>): Promise<StartableProject[]> {
  const names = available.map(entry => entry.project)
  const unknown = named.filter(name => !names.includes(name))
  if (unknown.length > 0) {
    throw new Error(`Cannot start ${unknown.join(', ')}: not a project with a start command. Startable: ${names.join(', ')}.`)
  }
  let chosen: readonly string[] = named
  if (chosen.length === 0) {
    if (options.all === true) {
      chosen = names
    } else if (dependencies.interactive ?? process.stdin.isTTY) {
      chosen = await (dependencies.choose ?? chooseProjects)(names)
    } else {
      throw new Error(`Name the projects to start, or pass --all. Startable: ${names.join(', ')}.`)
    }
  }

  return available.filter(entry => chosen.includes(entry.project))
}

/**
 * Starts several projects together, such as a frontend and the API it calls.
 *
 * @remarks
 * Projects named on the command line are checked against the ones that can be started, so a typo or a library is
 * refused with the list instead of reaching Nx. With none named, `--all` starts every one; otherwise a person is
 * asked, and a script (no terminal) is told to name them. Each project runs its own start command
 * (`nx run <project>:<target>`, the target its registered script names) and its output is shown with a `[project]`
 * prefix. They run until the first one stops: then the others are stopped too, so a crashed API does not leave a
 * frontend quietly talking to nothing, and Ctrl+C stops them all. Exits with the status of the first to stop.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param named - The projects named on the command line.
 * @param options - The command's flags.
 * @param dependencies - How to run processes and ask; real ones by default.
 * @returns A promise that resolves when the projects have stopped (or at once for a dry run).
 * @throws Error when a name is not startable, or none can be chosen.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runDev (workspaceRoot: string, named: readonly string[], options: DevOptions = {}, dependencies: Partial<DevDependencies> = {}): Promise<void> {
  const available = listStartableProjects(workspaceRoot)
  if (available.length === 0) {
    throw new Error('No project here has a start command. Add an app (`mnci add`) first; libraries are not started.')
  }
  const selected = await selectProjects(available, named, options, dependencies)
  for (const { project, target } of selected) {
    logger.info(`${project}: nx run ${project}:${target}`)
  }
  if (options.dryRun === true) {
    return
  }

  const start = dependencies.start ?? ((project: string, target: string, onLine: (line: string) => void) => spawnProject(workspaceRoot, project, target, onLine))
  const print = dependencies.print ?? ((line: string) => { console.log(line) })
  const running = selected.map(({ project, target }) => start(project, target, line => { print(`[${project}] ${line}`) }))
  const stopAll = (): void => {
    for (const each of running) {
      each.stop()
    }
  }
  process.once('SIGINT', stopAll)
  process.once('SIGTERM', stopAll)

  const first = await Promise.race(running.map(async (each, index) => ({ index, status: await each.exited })))
  stopAll()
  await Promise.all(running.map(async each => await each.exited))
  process.removeListener('SIGINT', stopAll)
  process.removeListener('SIGTERM', stopAll)
  logger.info(`${selected[first.index].project} stopped (${first.status}), so the rest were stopped too.`)
  if (first.status !== 0) {
    process.exitCode = first.status
  }
}
