import type { ArgumentDescription, CommandDescription, OptionDescription } from '../command-catalog'
import { ADOPT_STEPS, type AdoptStep } from './adopt-steps.config'
import { applicableOptions } from './applicable-options.policy'
import type { CommandAnswers, Prompter, PromptChoice } from './prompter.contract'

/** Options every commander command has that are not the person's to set here. */
const NOT_ASKED: ReadonlySet<string> = new Set(['help', 'version'])

/** The value that means "leave this optional argument out". */
const SKIP = ''

/**
 * Asks for one positional argument.
 *
 * @param argument - The argument's description.
 * @param prompter - How to ask.
 * @returns The words to put on the command line; none when an optional argument was skipped.
 * @throws Propagates a prompt's failure.
 * @typeParam None - this function has no generic type parameters.
 */
async function askArgument (argument: ArgumentDescription, prompter: Prompter): Promise<string[]> {
  const message = `${argument.name}${argument.required ? '' : ' (optional)'}: ${argument.description}`
  if (argument.choices !== undefined) {
    const choices: PromptChoice[] = argument.choices.map(choice => ({ name: choice, value: choice }))
    const value = await prompter.select(message, argument.required ? choices : [{ name: '(skip)', value: SKIP }, ...choices])

    return value === SKIP ? [] : [value]
  }
  const typed = await prompter.input(message, argument.required)
  const answer = typed.trim()
  if (answer === '') {
    return []
  }

  return argument.variadic ? answer.split(/\s+/) : [answer]
}

/**
 * Asks the value of one chosen option.
 *
 * @param option - The option's description.
 * @param prompter - How to ask.
 * @returns `true` for a switch, the value for a value option, every value for a repeatable one.
 * @throws Propagates a prompt's failure.
 * @typeParam None - this function has no generic type parameters.
 */
async function askOptionValue (option: OptionDescription, prompter: Prompter): Promise<boolean | string | string[]> {
  if (option.takesValue === 'none') {
    return true
  }
  const message = `${option.flags}: ${option.description}`
  if (option.choices !== undefined) {
    return await prompter.select(message, option.choices.map(choice => ({ name: choice, value: choice })))
  }
  if (option.repeatable) {
    const values: string[] = []
    let typed = await prompter.input(`${message} (an empty answer ends the list)`, false)
    while (typed.trim() !== '') {
      values.push(typed.trim())
      typed = await prompter.input(`${option.flags} (another, or empty to finish)`, false)
    }

    return values
  }
  const typed = await prompter.input(message, option.takesValue === 'required')
  const answer = typed.trim()

  return answer === '' ? true : answer
}

/**
 * Asks which step of `mnci adopt` to run.
 *
 * @param prompter - How to ask.
 * @returns The chosen step.
 * @throws Propagates a prompt's failure.
 * @typeParam None - this function has no generic type parameters.
 */
async function askAdoptStep (prompter: Prompter): Promise<AdoptStep> {
  const id = await prompter.select('Which adoption step?', ADOPT_STEPS.map(step => ({ name: step.label, value: step.id, description: step.summary })))

  return ADOPT_STEPS.find(step => step.id === id) as AdoptStep
}

/**
 * Asks everything one command needs, from the command's own description.
 *
 * @remarks
 * Positional arguments first (a closed set becomes a pick), then, for `adopt`, which step, then the options
 * that still apply: `add` offers the flags of the kind just chosen, `adopt` the flags of its step. Nothing here
 * names a command's flags, so a flag added to a command is asked about without changing this file; the flags
 * that decide what to ask (an `add` kind's, an `adopt` step's) are kept in step by a spec.
 *
 * @param command - The command's description.
 * @param prompter - How to ask.
 * @returns What was answered.
 * @throws Propagates a prompt's failure.
 * @typeParam None - this function has no generic type parameters.
 */
export async function askCommand (command: CommandDescription, prompter: Prompter): Promise<CommandAnswers> {
  const answers: CommandAnswers = { arguments: [], options: {} }
  for (const argument of command.arguments) {
    answers.arguments.push(...await askArgument(argument, prompter))
  }
  let adoptStep: AdoptStep | undefined
  if (command.name === 'adopt') {
    adoptStep = await askAdoptStep(prompter)
    if (adoptStep.switch !== undefined) {
      answers.options[adoptStep.switch] = true
    }
  }

  const offered = applicableOptions(command, { kind: command.name === 'add' ? answers.arguments[0] : undefined, adoptStep })
    .filter(option => !NOT_ASKED.has(option.name) && answers.options[option.name] === undefined)
  if (offered.length === 0) {
    return answers
  }
  const chosen = await prompter.checkbox('Options (space to select, enter to continue)', offered.map(option => ({ name: option.flags, value: option.name, description: option.description })))
  for (const name of chosen) {
    const option = offered.find(candidate => candidate.name === name) as OptionDescription
    const value = await askOptionValue(option, prompter)
    if (!(Array.isArray(value) && value.length === 0)) {
      answers.options[name] = value
    }
  }

  return answers
}
