/**
 * The mnci CLI commands the extension offers, each as the VS Code command `mnci.<name>`.
 *
 * @remarks
 * Every CLI command that is not `inspect` (the machine-readable ones) must be here and in
 * `package.json`'s `contributes.commands`; a test compares them with a snapshot of
 * `mnci commands --json`, so a command added to the CLI cannot be forgotten.
 */
export const CLI_COMMAND_NAMES: readonly string[] = ['new', 'upgrade', 'doctor', 'add', 'install', 'sync', 'up', 'ci']

/**
 * Commands that exist only in the extension.
 *
 * @remarks
 * Declared in `package.json` beside the CLI ones; a test keeps the two lists in step.
 */
export const EXTENSION_ONLY_COMMAND_NAMES: readonly string[] = ['refresh', 'runTarget', 'updateCli']

/**
 * The VS Code command id for a command name.
 *
 * @remarks
 * The prefix is the extension's command namespace in `package.json`.
 *
 * @param name - A name from {@link CLI_COMMAND_NAMES} or {@link EXTENSION_ONLY_COMMAND_NAMES}.
 * @returns The id, as declared in `package.json`.
 * @throws Never - pure formatting.
 * @typeParam None - this function has no generic type parameters.
 */
export function commandId (name: string): string {
  return `mnci.${name}`
}
