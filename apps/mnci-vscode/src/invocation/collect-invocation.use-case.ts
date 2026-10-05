import type { CommandDescription, OptionDescription } from '../cli-contracts'
import { buildArguments, type OptionChoice } from './build-arguments.algorithm'
import type { Prompter } from './prompter.contract'

/**
 * What to run: the arguments after `mnci`, and where, when the user chose a directory.
 *
 * @remarks
 * `cwd` is set only by commands that create something in the current directory (`new`).
 * @typeParam None - this interface has no generic type parameters.
 */
export interface Invocation {
  readonly arguments: readonly string[]
  readonly cwd?:      string
}

/**
 * Splits free text into values on whitespace.
 *
 * @remarks
 * Used for answers that hold several values, such as a list of package names.
 *
 * @param text - What the user typed.
 * @returns The non-empty words.
 * @throws Never - pure string work.
 * @typeParam None - this function has no generic type parameters.
 */
export function words (text: string): string[] {
  return text.split(/\s+/).filter(word => word !== '')
}

/**
 * Asks for one option's value, or records it as a switch.
 *
 * @param option - The option.
 * @param prompter - How to ask.
 * @returns The choice, or `undefined` when the user cancelled.
 * @throws Never - cancellation is a result.
 * @typeParam None - this function has no generic type parameters.
 */
async function askOption (option: OptionDescription, prompter: Prompter): Promise<OptionChoice | undefined> {
  if (option.takesValue === 'none') {
    return { name: option.name }
  }
  if (option.choices && option.choices.length > 0) {
    const picked = await prompter.pickOne(option.choices.map(choice => ({ label: choice, value: choice })), `--${option.name}: ${option.description}`)

    return picked === undefined ? undefined : { name: option.name, value: picked }
  }
  const text = await prompter.askText(`--${option.name}: ${option.description}`, { required: option.takesValue === 'required' })
  if (text === undefined) {
    return undefined
  }

  const several = option.variadic || option.repeatable === true

  return { name: option.name, value: several ? words(text) : text.trim(), repeat: option.repeatable === true }
}

/**
 * Lets the user pick options of a command, then asks for each one's value.
 *
 * @remarks
 * Options in `required` are asked without being offered: the command cannot run without them.
 * With nothing left to offer, the picker is skipped entirely.
 *
 * @param command - The command.
 * @param prompter - How to ask.
 * @param only - When set, only these option names are offered (the flags that apply to a kind).
 * @param required - Option names that are always asked.
 * @returns The chosen options, or `undefined` when the user cancelled.
 * @throws Never - cancellation is a result.
 * @typeParam None - this function has no generic type parameters.
 */
export async function collectOptions (
  command: CommandDescription,
  prompter: Prompter,
  only?: readonly string[],
  required: readonly string[] = [],
): Promise<OptionChoice[] | undefined> {
  const offerable = command.options.filter(option => only === undefined || only.includes(option.name))
  const mandatory = offerable.filter(option => required.includes(option.name))
  const optional = offerable.filter(option => !required.includes(option.name))
  const chosen: OptionDescription[] = [...mandatory]

  if (optional.length > 0) {
    const picked = await prompter.pickMany(
      optional.map(option => ({ label: option.flags, value: option.name, detail: option.description })),
      'Add options (optional): confirm with nothing chosen to skip',
    )
    if (picked === undefined) {
      return undefined
    }
    chosen.push(...optional.filter(option => picked.includes(option.name)))
  }

  const answers: OptionChoice[] = []
  for (const option of chosen) {
    const answer = await askOption(option, prompter)
    if (answer === undefined) {
      return undefined
    }
    answers.push(answer)
  }

  return answers
}

/**
 * Collects the arguments of any CLI command from its own description.
 *
 * @remarks
 * Works for every command because it reads the description the CLI printed: each argument is
 * asked (a choice list when the CLI names the choices), then the options. A command added to
 * the CLI is usable here the day it ships. `new` also asks where to create the workspace.
 *
 * @param command - The command's description.
 * @param prompter - How to ask.
 * @returns What to run, or `undefined` when the user cancelled.
 * @throws Never - cancellation is a result.
 * @typeParam None - this function has no generic type parameters.
 */
export async function collectInvocation (command: CommandDescription, prompter: Prompter): Promise<Invocation | undefined> {
  const positionals: string[] = []
  for (const argument of command.arguments) {
    if (argument.choices && argument.choices.length > 0) {
      const entries = argument.choices.map(choice => ({ label: choice, value: choice }))
      const picked = await prompter.pickOne(argument.required ? entries : [{ label: '(none)', value: '' }, ...entries], argument.description)
      if (picked === undefined) {
        return undefined
      }
      positionals.push(picked)
      continue
    }
    const text = await prompter.askText(`${argument.name}${argument.required ? '' : ' (optional)'}: ${argument.description}`, { required: argument.required })
    if (text === undefined) {
      return undefined
    }
    positionals.push(...(argument.variadic ? words(text) : [text.trim()]))
  }

  const options = await collectOptions(command, prompter)
  if (options === undefined) {
    return undefined
  }

  const cwd = command.name === 'new' ? await prompter.pickFolder('Where should the workspace be created?') : undefined
  if (cwd === undefined && command.name === 'new') {
    return undefined
  }

  return { arguments: buildArguments(command.name, positionals, options), cwd }
}
