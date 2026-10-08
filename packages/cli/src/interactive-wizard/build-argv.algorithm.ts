import type { CommandDescription, OptionDescription } from '../command-catalog'
import type { CommandAnswers } from './prompter.contract'

/**
 * The flag as it is typed on a command line.
 *
 * @remarks
 * Commander names a `--no-install` switch `no-install`, so the name already carries the `no-`.
 *
 * @param option - An option of a command.
 * @returns Its long form, such as `--scope` or `--no-install`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function longFlag (option: OptionDescription): string {
  return `--${option.name}`
}

/**
 * Builds the argument list that runs a command the way the person answered.
 *
 * @remarks
 * The same list the flag form takes, so the wizard runs the real command rather than a copy of it:
 * the command name, its positional arguments, then each answered option. A switch becomes its flag, a value
 * option its flag and value, a repeatable one its flag once per value. An option that is not one of the
 * command's own is a mistake in the caller and throws, so a typo cannot silently drop a choice.
 *
 * @param command - The command's description.
 * @param answers - What was answered.
 * @returns The arguments to hand to the program, without the `node mnci` prefix.
 * @throws Error when an answer names an option the command does not have.
 * @typeParam None - this function has no generic type parameters.
 */
export function buildArgv (command: CommandDescription, answers: CommandAnswers): string[] {
  const argv = [command.name, ...answers.arguments]
  for (const [name, answer] of Object.entries(answers.options)) {
    const option = command.options.find(candidate => candidate.name === name)
    if (option === undefined) {
      throw new Error(`mnci ${command.name} has no option --${name}`)
    }
    if (answer === false) {
      continue
    }
    if (typeof answer === 'boolean') {
      argv.push(longFlag(option))
    } else {
      const values = Array.isArray(answer) ? answer : [answer]
      for (const value of values) {
        argv.push(longFlag(option), value)
      }
    }
  }

  return argv
}

/**
 * Writes a command line the way a person would type it, for showing what the wizard is about to run.
 *
 * @remarks
 * For display only: the wizard hands the program the argument list itself, never this string.
 *
 * @param argv - The arguments from {@link buildArgv}.
 * @returns `mnci` followed by the arguments, quoting any that contain a space.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function formatCommandLine (argv: readonly string[]): string {
  return ['mnci', ...argv.map(argument => (/\s/.test(argument) ? JSON.stringify(argument) : argument))].join(' ')
}
