import * as vscode from 'vscode'
import type { CliLocation } from '../cli-access'
import type { Invocation } from './collect-invocation.use-case'
import { buildCommandLine } from './quote-command-line.algorithm'

/** The name of the terminal the extension runs commands in. */
const TERMINAL_NAME = 'MNCI'

/**
 * Runs any command line in the `MNCI` integrated terminal, so the user sees it, can answer
 * its prompts and can scroll its output.
 *
 * @remarks
 * Reuses the `MNCI` terminal when it was opened in the same directory, and opens a new one
 * otherwise (a workspace created elsewhere).
 *
 * @param command - The executable (`mnci`, `npm`, `npx`).
 * @param arguments_ - Its arguments.
 * @param cwd - The directory to run in.
 * @returns Nothing.
 * @throws Error when any part holds a shell metacharacter.
 * @typeParam None - this function has no generic type parameters.
 */
export function runCommandInTerminal (command: string, arguments_: readonly string[], cwd: string | undefined): void {
  const line = buildCommandLine(command, arguments_, vscode.env.shell)
  const existing = vscode.window.terminals.find(terminal => terminal.name === TERMINAL_NAME && (terminal.creationOptions as vscode.TerminalOptions).cwd === cwd)
  const terminal = existing ?? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd })

  terminal.show()
  terminal.sendText(line)
}

/**
 * Runs an mnci command in the `MNCI` terminal.
 *
 * @remarks
 * The terminal is the extension's window onto the CLI: the user sees exactly what ran.
 *
 * @param location - Which CLI to start.
 * @param invocation - The arguments, and the directory when the user chose one.
 * @param workspaceRoot - The workspace folder, used when the invocation names no directory.
 * @returns Nothing.
 * @throws Error when an argument holds a shell metacharacter.
 * @typeParam None - this function has no generic type parameters.
 */
export function runInTerminal (location: CliLocation, invocation: Invocation, workspaceRoot: string | undefined): void {
  runCommandInTerminal(location.command, [...location.prefix, ...invocation.arguments], invocation.cwd ?? workspaceRoot)
}
