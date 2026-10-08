/**
 * One choice offered by a prompt.
 *
 * @remarks
 * `value` is what comes back; `name` is what the person reads.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PromptChoice {
  /** The line shown. */
  name:         string
  /** What the prompt returns when it is picked. */
  value:        string
  /** A longer explanation shown beside the highlighted choice. */
  description?: string
  /** A heading to list it under; a new heading starts a new section of the pick. */
  group?:       string
}

/**
 * The four questions the wizard asks, behind an interface so a test can answer them.
 *
 * @remarks
 * The real one is built on `@inquirer/prompts`; the wizard's flow never imports that package itself.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface Prompter {
  /** Picks one of several. */
  select (message: string, choices: readonly PromptChoice[]): Promise<string>
  /** Picks any number of several, possibly none. */
  checkbox (message: string, choices: readonly PromptChoice[]): Promise<string[]>
  /** Asks for text; an empty answer is allowed unless `required`. */
  input (message: string, required: boolean): Promise<string>
  /** Asks yes or no. */
  confirm (message: string, fallback: boolean): Promise<boolean>
}

/**
 * What the person answered for one command.
 *
 * @remarks
 * `options` is keyed by the long option name without dashes. A switch is `true`; a value option carries its
 * value, or every value when it can be repeated.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CommandAnswers {
  /** Positional arguments in order; an unanswered optional one is left out. */
  arguments: string[]
  /** Options by name. */
  options:   Record<string, boolean | string | string[]>
}
