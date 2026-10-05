/**
 * One option the user chose for a command.
 *
 * @remarks
 * A switch has no `value`; a value flag has one string, or several for a variadic flag.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface OptionChoice {
  /** The long name without dashes (`scope`, `no-install`). */
  readonly name:    string
  readonly value?:  string | readonly string[]
  /** Write the flag once per value (`--workspace a --workspace b`) instead of once with all of them. */
  readonly repeat?: boolean
}

/**
 * Builds the argument list for `mnci <command> …` from what the user answered.
 *
 * @remarks
 * Positionals come first and options after them, so an option can never swallow a positional.
 * A flag the CLI marks repeatable is written once per value.
 * Empty positionals are dropped (an optional argument the user left blank).
 *
 * @param command - The command name.
 * @param positionals - The positional answers, in order; empty ones are skipped.
 * @param options - The chosen options.
 * @returns The arguments, starting with the command name.
 * @throws Never - pure list building.
 * @typeParam None - this function has no generic type parameters.
 */
export function buildArguments (command: string, positionals: readonly string[], options: readonly OptionChoice[]): string[] {
  const optionArguments = options.flatMap((option): string[] => {
    if (option.value === undefined) {
      return [`--${option.name}`]
    }

    if (typeof option.value === 'string') {
      return [`--${option.name}`, option.value]
    }

    return option.repeat === true
      ? option.value.flatMap(value => [`--${option.name}`, value])
      : [`--${option.name}`, ...option.value]
  })

  return [command, ...positionals.filter(positional => positional !== ''), ...optionArguments]
}
