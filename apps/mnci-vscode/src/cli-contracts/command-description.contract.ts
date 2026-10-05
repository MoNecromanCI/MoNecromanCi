/**
 * Where a command is listed in the sidebar; `inspect` marks the commands that only describe the CLI.
 *
 * @remarks
 * Mirrors `CommandGroup` in the CLI's `command-catalog` slice, which is the source of truth.
 * @typeParam None - this type has no generic type parameters.
 */
export type CommandGroup = 'workspace' | 'projects' | 'dependencies' | 'pipeline' | 'inspect'

/**
 * One positional argument of a CLI command.
 *
 * @remarks
 * Mirrors the CLI's `mnci commands --json`.
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
 * One option of a CLI command.
 *
 * @remarks
 * Mirrors the CLI's `mnci commands --json`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface OptionDescription {
  /** The long name without dashes (`scope` for `--scope`). */
  readonly name:          string
  readonly flags:         string
  readonly short?:        string
  readonly description:   string
  /** `none` is a switch. */
  readonly takesValue:    'none' | 'required' | 'optional'
  readonly variadic:      boolean
  /** The flag may be given several times (`--workspace a --workspace b`). Absent in older CLIs. */
  readonly repeatable?:   boolean
  /** True for a `--no-<name>` switch. */
  readonly negated:       boolean
  readonly choices?:      readonly string[]
  readonly defaultValue?: string | number | boolean
}

/**
 * A CLI command: what it is, where it goes, how to call it.
 *
 * @remarks
 * Mirrors the CLI's `mnci commands --json`.
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
