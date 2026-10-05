import type { CliSession } from '../cli-session'
import { collectAddInvocation } from './collect-add-invocation.use-case'
import { collectInstallInvocation } from './collect-install-invocation.use-case'
import { collectInvocation, type Invocation } from './collect-invocation.use-case'
import type { Prompter } from './prompter.contract'

/**
 * What invoking a command needs from the outside.
 *
 * @remarks
 * `run` hands the finished invocation to a terminal.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface InvokeDependencies {
  readonly session:  CliSession
  readonly prompter: Prompter
  readonly run:      (invocation: Invocation) => void
}

/**
 * Walks the user through one mnci command and runs it.
 *
 * @remarks
 * `add` and `install` have flows of their own (kinds grouped by language, projects offered
 * from the workspace); every other command is collected generically from the description the
 * CLI printed. Only `new` runs without a workspace. A command the installed CLI does not have
 * is reported with the way out, since the extension may be newer than the CLI.
 *
 * @param name - The CLI command name.
 * @param dependencies - The session, the prompter, and how to run the result.
 * @returns Nothing; a cancelled flow does nothing.
 * @throws Error when no workspace is open for a command that needs one, or the CLI lacks the command.
 * @typeParam None - this function has no generic type parameters.
 */
export async function invokeCommand (name: string, dependencies: InvokeDependencies): Promise<void> {
  const { session, prompter, run } = dependencies
  if (name !== 'new' && session.workspaceRoot === undefined) {
    throw new Error(`Open a folder that holds an mnci workspace to run "mnci ${name}", or use "MNCI: New workspace".`)
  }
  const commands = await session.commands()
  const command = commands.find(candidate => candidate.name === name)
  if (command === undefined) {
    throw new Error(`The installed mnci has no "${name}" command. Update mnci (see the MNCI Update view).`)
  }

  const invocation =
    name === 'add'
      ? await collectAddInvocation(command, await session.kinds(), prompter)
      : (name === 'install'
          ? await collectInstallInvocation(await session.projects(), prompter)
          : await collectInvocation(command, prompter))
  if (invocation !== undefined) {
    run(invocation)
  }
}
