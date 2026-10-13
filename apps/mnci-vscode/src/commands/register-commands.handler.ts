import * as vscode from 'vscode'
import { runMnciJson } from '../cli-access'
import { updateCli, updateWorkspaceCli } from '../cli-update'
import { addMcpConfig } from '../mcp-server'
import type { CliSession } from '../cli-session'
import { runDoctorCheck } from '../doctor-check'
import { openUpdatesPanel, showUpdatesPanel } from '../updates-panel'
import { invokeCommand, runCommandInTerminal, runInTerminal, VSCODE_PROMPTER } from '../invocation'
import { nameFrom } from './command-arguments.algorithm'
import { CLI_COMMAND_NAMES, commandId } from './extension-commands.config'
import { runTarget } from './run-target.use-case'
import { createDoctorSurface, createUpdateSurface } from './vscode-surfaces.client'

/**
 * Registers every `mnci.*` command with VS Code.
 *
 * @remarks
 * `doctor` shows its result in the Problems panel; `refresh`, `runTarget` and `updateCli` are the
 * extension's own; every other CLI command goes through the flow that asks for its arguments
 * and runs it in a terminal. An error from any of them is shown as a message, never swallowed
 * and never thrown into the editor.
 *
 * @param session - The CLI's cached answers.
 * @returns What to dispose when the extension deactivates.
 * @throws Never - handler failures become messages.
 * @typeParam None - this function has no generic type parameters.
 */
export function registerCommands (session: CliSession): vscode.Disposable[] {
  const diagnostics = vscode.languages.createDiagnosticCollection('mnci')
  const doctorSurface = createDoctorSurface(session.workspaceRoot, diagnostics)
  const updateSurface = createUpdateSurface()
  const invokeDependencies = {
    session,
    prompter: VSCODE_PROMPTER,
    run:      (invocation: Parameters<typeof runInTerminal>[1]) => { runInTerminal(session.location(), invocation, session.workspaceRoot) },
  }

  const handlers: Record<string, (...arguments_: unknown[]) => Promise<void> | void> = {
    ...Object.fromEntries(CLI_COMMAND_NAMES.map(name => [name, async () => { await invokeCommand(name, invokeDependencies) }])),
    doctor: async () => { await runDoctorCheck(session, doctorSurface) },
    up:     async () => {
      await openUpdatesPanel({
        location:      () => session.location(),
        workspaceRoot: session.workspaceRoot,
        run:           runMnciJson,
        runInTerminal: arguments_ => { runInTerminal(session.location(), { arguments: arguments_ }, session.workspaceRoot) },
        surface:       showUpdatesPanel(),
      })
    },
    refresh:   () => { session.refresh() },
    // A one-click run from the Commands view: the command name and the arguments to give it, with no prompt.
    runPreset: (...given) => {
      const words = given.map(entry => nameFrom(entry)).filter((word): word is string => word !== undefined)
      if (words.length > 0) {
        runInTerminal(session.location(), { arguments: words }, session.workspaceRoot)
      }
    },
    runTarget: async (project, target) => {
      await runTarget(
        { session, prompter: VSCODE_PROMPTER, run: runCommandInTerminal },
        nameFrom(project),
        nameFrom(target),
      )
    },
    updateCli:       async () => { await updateCli(session, updateSurface) },
    updateWorkspace: async () => { await updateWorkspaceCli(session, updateSurface) },
    addMcpServer:    () => {
      if (session.workspaceRoot === undefined) {
        void vscode.window.showWarningMessage('Open a workspace folder first: the MCP server is registered in its .mcp.json.')

        return
      }
      const result = addMcpConfig(session.workspaceRoot)
      const messages = {
        'written':       'mnci is registered in .mcp.json. Restart your assistant (Claude Code: /mcp) to start it.',
        'already-there': 'mnci is already registered in .mcp.json.',
        'unreadable':    '.mcp.json is not a JSON object, so it was left alone. Add the mnci server by hand: {"mcpServers":{"mnci":{"command":"npx","args":["mnci","mcp"]}}}',
      }
      void vscode.window.showInformationMessage(messages[result])
      session.refresh()
    },
  }

  return [
    diagnostics,
    ...Object.entries(handlers).map(([name, handler]) =>
      vscode.commands.registerCommand(commandId(name), async (...arguments_: unknown[]) => {
        try {
          await handler(...arguments_)
        } catch (error) {
          void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
        }
      })),
  ]
}
