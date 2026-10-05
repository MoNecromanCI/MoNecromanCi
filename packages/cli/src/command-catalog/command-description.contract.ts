/**
 * Which sidebar group a command belongs to in an editor. `inspect` holds the machine-readable commands themselves.
 *
 * @remarks
 * Four groups for the commands a person runs, and `inspect` for the commands that only describe the CLI and the workspace, which an editor does not list.
 * @typeParam None - this type has no generic type parameters.
 */
export type CommandGroup = 'workspace' | 'projects' | 'dependencies' | 'pipeline' | 'inspect'

/**
 * One positional argument of a command.
 *
 * @remarks
 * Read from the commander argument, so it cannot drift from the CLI.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ArgumentDescription {
  readonly name:        string
  readonly description: string
  readonly required:    boolean
  readonly variadic:    boolean
  /** The accepted values, when the argument is a closed set. */
  readonly choices?:    readonly string[]
}

/**
 * One option (flag) of a command.
 *
 * @remarks
 * Read from the commander option, so it cannot drift from the CLI.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface OptionDescription {
  /** The long name without dashes (`scope` for `--scope`). */
  readonly name:          string
  /** The flags as written (`-y, --yes`). */
  readonly flags:         string
  readonly short?:        string
  readonly description:   string
  /** Whether the flag takes a value: `none` is a switch. */
  readonly takesValue:    'none' | 'required' | 'optional'
  readonly variadic:      boolean
  /** The flag may be given several times (`--workspace a --workspace b`); each use adds one value. */
  readonly repeatable:    boolean
  /** True for a `--no-<name>` switch. */
  readonly negated:       boolean
  readonly choices?:      readonly string[]
  readonly defaultValue?: string | number | boolean
}

/**
 * Everything an editor needs to offer one command: what it is, where it goes, how to call it.
 *
 * @remarks
 * Read from the commander program by `describeCommands`, and grouped by `COMMAND_GROUPS`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CommandDescription {
  readonly name:        string
  readonly aliases:     readonly string[]
  readonly group:       CommandGroup
  readonly description: string
  readonly arguments:   readonly ArgumentDescription[]
  readonly options:     readonly OptionDescription[]
}
