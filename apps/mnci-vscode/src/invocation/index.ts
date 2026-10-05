/**
 * Asking the user what to run, and running mnci commands in a terminal.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { invokeCommand, type InvokeDependencies } from './invoke-command.use-case'
export type { Invocation } from './collect-invocation.use-case'
export type { Prompter } from './prompter.contract'
export { runCommandInTerminal, runInTerminal } from './run-in-terminal.client'
export { VSCODE_PROMPTER } from './vscode-prompter.client'
