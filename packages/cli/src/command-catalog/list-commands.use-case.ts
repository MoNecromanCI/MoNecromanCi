import type { Command } from 'commander'
import { logger, printJson } from '../terminal'
import { describeCommands } from './describe-commands.algorithm'

/**
 * Flags of `mnci commands`.
 *
 * @remarks
 * `mnci commands` has only the one flag.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CommandsOptions {
  /** Print the catalog as one JSON document, for an editor or a script. */
  json?: boolean
}

/**
 * Prints every command of the CLI with what it does and how to call it.
 *
 * @remarks
 * `--json` is the contract the editor extension builds its menu from; without it the output
 * is a plain list for a person.
 *
 * @param program - The built commander program.
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Error when a command has no group (see `describeCommands`).
 * @typeParam None - this function has no generic type parameters.
 */
export function runCommands (program: Command, options: CommandsOptions): void {
  const commands = describeCommands(program)
  if (options.json === true) {
    printJson(commands)

    return
  }
  for (const command of commands) {
    logger.info(`${command.name.padEnd(10)} ${command.description}`)
  }
}
