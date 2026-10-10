/**
 * Options accepted by the `function-application` generator.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface FunctionAppGeneratorSchema {
  /** The project name. */
  name:       string
  /** Workspace-relative directory (defaults to `apps/<name>`). */
  directory?: string
  /** Write the module as an empty package with one smoke test, not the greeting example. */
  empty?:     boolean
}
