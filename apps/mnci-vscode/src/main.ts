import { homedir } from 'node:os'
import * as vscode from 'vscode'
import { locateCli, MACHINE_PROBES, runMnciJson } from './cli-access'
import { CliSession } from './cli-session'
import { registerCommands } from './commands'
import { registerSidebarViews } from './sidebar'
import { watchWorkspace } from './watching'

/**
 * Starts the extension: the CLI session, the sidebar, the commands and the file watcher.
 *
 * @remarks
 * Nothing runs the CLI until a view or a command asks. The `mnci.cliPath` setting is read each
 * time the CLI is located, and a change to it refreshes everything. `mnci.isWorkspace` tells
 * the welcome views whether the open folder holds an mnci workspace.
 *
 * @param context - The extension context, which owns the disposables.
 * @returns Nothing.
 * @throws Never - activation failures would stop the extension, so every start is guarded below it.
 * @typeParam None - this function has no generic type parameters.
 */
export function activate (context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const session = new CliSession({
    workspaceRoot,
    fallbackDirectory: homedir(),
    locate:            () => locateCli(
      { configured: vscode.workspace.getConfiguration('mnci').get<string>('cliPath'), workspaceRoot, platform: process.platform },
      MACHINE_PROBES,
    ),
    run: runMnciJson,
  })

  void vscode.workspace.findFiles('nx.json', undefined, 1).then(found => vscode.commands.executeCommand('setContext', 'mnci.isWorkspace', found.length > 0))

  context.subscriptions.push(
    ...registerCommands(session),
    ...registerSidebarViews(session),
    ...watchWorkspace(session),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('mnci.cliPath')) {
        session.refresh()
      }
    }),
  )
}

/**
 * Stops the extension.
 *
 * @remarks
 * Everything it started is disposed through `context.subscriptions`.
 *
 * @param None - this function takes no parameters.
 * @returns Nothing.
 * @throws Never - there is nothing to fail.
 * @typeParam None - this function has no generic type parameters.
 */
export function deactivate (): void {}
