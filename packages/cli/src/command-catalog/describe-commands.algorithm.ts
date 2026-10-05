import type { Command, Option } from 'commander'
import { COMMAND_GROUPS } from './command-groups.config'
import type { ArgumentDescription, CommandDescription, OptionDescription } from './command-description.contract'

/**
 * Reads one commander option into its description.
 *
 * @param option - A commander option.
 * @returns The option's description.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
function describeOption (option: Option): OptionDescription {
  const isScalar = ['string', 'number', 'boolean'].includes(typeof option.defaultValue)

  return {
    name:         option.name(),
    flags:        option.flags,
    short:        option.short,
    description:  option.description,
    takesValue:   option.required ? 'required' : (option.optional ? 'optional' : 'none'),
    variadic:     option.variadic,
    negated:      option.negate,
    choices:      option.argChoices,
    defaultValue: isScalar ? (option.defaultValue as string | number | boolean) : undefined,
  }
}

/**
 * Describes every command of a commander program, for tools that build their own UI from it.
 *
 * @remarks
 * Read from the program itself, never restated: a command added to `main.ts` shows up here
 * with its description, arguments, choices and options, so an editor menu cannot drift from
 * the CLI. The `help` command and each command's `--help` flag are left out. Each command is
 * placed in a group by `COMMAND_GROUPS`; one that has no entry throws, so a new command
 * cannot reach an editor ungrouped.
 *
 * @param program - The built commander program.
 * @returns One description per visible command, in registration order.
 * @throws Error when a command has no entry in `COMMAND_GROUPS`.
 * @typeParam None - this function has no generic type parameters.
 */
export function describeCommands (program: Command): CommandDescription[] {
  return program.commands
    .filter(command => command.name() !== 'help')
    .map((command): CommandDescription => {
      const group = COMMAND_GROUPS[command.name()]
      if (group === undefined) {
        throw new Error(`Command '${command.name()}' has no group in COMMAND_GROUPS (command-catalog/command-groups.config.ts).`)
      }
      const args: ArgumentDescription[] = command.registeredArguments.map(argument => ({
        name:        argument.name(),
        description: argument.description,
        required:    argument.required,
        variadic:    argument.variadic,
        choices:     argument.argChoices,
      }))

      return {
        name:        command.name(),
        aliases:     command.aliases(),
        group,
        description: command.description(),
        arguments:   args,
        options:     command.options.map(option => describeOption(option)),
      }
    })
}
