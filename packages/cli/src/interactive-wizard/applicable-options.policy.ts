import type { CommandDescription, OptionDescription } from '../command-catalog'
import { PROJECT_KIND_CATALOG } from '../project-scaffolding'
import { ADOPT_GLOBAL_OPTIONS, type AdoptStep } from './adopt-steps.config'

/**
 * What has been decided so far about a command, which narrows the options worth asking about.
 *
 * @remarks
 * `kind` is the project kind chosen for `add`; `adoptStep` is the step chosen for `adopt`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface OptionContext {
  /** The kind chosen for `add`. */
  kind?:      string
  /** The step chosen for `adopt`. */
  adoptStep?: AdoptStep
}

/**
 * The options of `add` that apply to a kind.
 *
 * @remarks
 * An option no kind lists is kind-agnostic and always applies. Reading the catalog keeps this in step with the
 * kinds: a kind's own flags are what its entry says, and a spec checks the catalog against the command.
 *
 * @param command - The `add` command.
 * @param kind - The kind chosen, when there is one.
 * @returns The options to offer.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function optionsOfAdd (command: CommandDescription, kind: string | undefined): OptionDescription[] {
  const claimed = new Set(PROJECT_KIND_CATALOG.flatMap(entry => entry.flags))
  const own = new Set(PROJECT_KIND_CATALOG.find(entry => entry.kind === kind)?.flags)

  return command.options.filter(option => !claimed.has(option.name) || own.has(option.name))
}

/**
 * The options worth asking about for a command, given what is already decided.
 *
 * @remarks
 * Everything the command declares, except where the choice already narrows it: an `add` kind takes its own
 * flags, an `adopt` step takes its own flags and the global ones, and the switch that selects an adopt step
 * is set by choosing the step rather than asked.
 *
 * @param command - The command's description.
 * @param context - What has been decided so far.
 * @returns The options to offer, in the command's own order.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function applicableOptions (command: CommandDescription, context: OptionContext = {}): OptionDescription[] {
  if (command.name === 'add') {
    return optionsOfAdd(command, context.kind)
  }
  if (command.name === 'adopt') {
    const step = context.adoptStep
    const wanted = new Set([...step?.options ?? [], ...ADOPT_GLOBAL_OPTIONS])

    return command.options.filter(option => wanted.has(option.name))
  }

  return [...command.options]
}
