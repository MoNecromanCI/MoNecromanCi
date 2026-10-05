/**
 * The `mnci.*` commands of the extension.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { CLI_COMMAND_NAMES, commandId, EXTENSION_ONLY_COMMAND_NAMES } from './extension-commands.config'
export { registerCommands } from './register-commands.handler'
