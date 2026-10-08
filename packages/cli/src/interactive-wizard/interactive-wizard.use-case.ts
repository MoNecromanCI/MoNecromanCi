import { join } from 'node:path'
import type { Command } from 'commander'
import { describeCommands, type CommandDescription, type CommandGroup } from '../command-catalog'
import { fileExists } from '../file-system'
import { logger } from '../terminal'
import { askCommand } from './ask-command.use-case'
import { buildArgv, formatCommandLine } from './build-argv.algorithm'
import { createInquirerPrompter } from './inquirer-prompter.client'
import type { Prompter, PromptChoice } from './prompter.contract'

/** What each group is called in the menu. */
const GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
  workspace:    'Workspace',
  projects:     'Projects',
  dependencies: 'Dependencies',
  pipeline:     'Pipeline',
  inspect:      'Inspect',
}

/**
 * Commands listed under a different group in the wizard than in an editor.
 *
 * @remarks
 * `adopt` is read-only to an editor, which keeps it in `inspect` so the extension does not offer it, but a person
 * at a terminal looks for it under the workspace.
 */
export const WIZARD_GROUP_OVERRIDES: Readonly<Record<string, CommandGroup>> = { adopt: 'workspace' }

/** The groups in the order the menu lists them inside a workspace, and outside one. */
const ORDER_IN_WORKSPACE: readonly CommandGroup[] = ['projects', 'dependencies', 'workspace', 'pipeline', 'inspect']
const ORDER_OUTSIDE: readonly CommandGroup[] = ['workspace', 'projects', 'dependencies', 'pipeline', 'inspect']

/** The longest summary shown beside a command. */
const SUMMARY_LENGTH = 110

/**
 * The first sentence of a command's description, short enough for a menu line.
 *
 * @param description - The command's description.
 * @returns Up to the first full stop or dash, cut at {@link SUMMARY_LENGTH}.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function summarise (description: string): string {
  const first = description.split(/\.\s| — /, 1)[0]

  return first.length > SUMMARY_LENGTH ? `${first.slice(0, SUMMARY_LENGTH - 1)}…` : first
}

/**
 * Lists every command as a choice, in sections.
 *
 * @remarks
 * Built from the commands themselves, so a command added to the program is in the menu. Inside a workspace the
 * projects and dependencies sections come first, since that is what is most often wanted there; outside one,
 * the workspace section does.
 *
 * @param commands - The program's commands, described.
 * @param inWorkspace - Whether the current directory is an Nx workspace.
 * @returns The choices, each under its section heading.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function wizardMenu (commands: readonly CommandDescription[], inWorkspace: boolean): PromptChoice[] {
  const groupOf = (command: CommandDescription): CommandGroup => WIZARD_GROUP_OVERRIDES[command.name] ?? command.group
  const order = inWorkspace ? ORDER_IN_WORKSPACE : ORDER_OUTSIDE

  return order.flatMap(group => commands
    .filter(command => groupOf(command) === group)
    .map(command => ({ name: `${command.name.padEnd(9)} ${summarise(command.description)}`, value: command.name, group: GROUP_LABELS[group] })))
}

/**
 * Runs the guided wizard shown when `mnci` is invoked with no arguments.
 *
 * @remarks
 * Offers every command of the program, asks its arguments and the options that apply from the command's own
 * description, shows the command line that results, and runs it through the same program the flags go through.
 * Nothing about a command lives here, so the wizard and the flag form cannot drift: a command or option added
 * to the program is asked about, and a spec fails when one of the few flags the wizard groups by hand
 * (an `add` kind's, an `adopt` step's) is out of step with the command.
 *
 * @param program - The program to describe and to run.
 * @param prompter - How to ask; the terminal by default.
 * @param workingDirectory - Where the person is; the current directory by default.
 * @returns A promise that resolves when the chosen command completes, or at once if it was declined.
 * @throws Propagates prompt errors and any failure from the dispatched command.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runInteractive (program: Command, prompter: Prompter = createInquirerPrompter(), workingDirectory: string = process.cwd()): Promise<void> {
  const commands = describeCommands(program)
  const inWorkspace = fileExists(join(workingDirectory, 'nx.json'))
  const name = await prompter.select('What would you like to do?', wizardMenu(commands, inWorkspace))
  const command = commands.find(candidate => candidate.name === name) as CommandDescription

  const argv = buildArgv(command, await askCommand(command, prompter))
  logger.info(`Running: ${formatCommandLine(argv)}`)
  if (await prompter.confirm('Run it?', true)) {
    await program.parseAsync(argv, { from: 'user' })
  } else {
    logger.info('Nothing was run.')
  }
}
