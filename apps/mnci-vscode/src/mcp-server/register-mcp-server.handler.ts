import * as vscode from 'vscode'
import type { CliSession } from '../cli-session'
import { mcpServerLaunch } from './mcp-server-definition.algorithm'

/** The part of the MCP API this uses, which VS Code added after the engine floor of this extension (1.101). */
interface McpApi {
  readonly lm?: {
    readonly registerMcpServerDefinitionProvider?: (
      id: string,
      provider: { onDidChangeMcpServerDefinitions: vscode.Event<void>, provideMcpServerDefinitions: () => unknown[] },
    ) => vscode.Disposable
  }
  readonly McpStdioServerDefinition?: new (label: string, command: string, args?: string[]) => { cwd?: vscode.Uri }
}

/**
 * Offers `mnci mcp` to the editor's own MCP client (Copilot agent mode and other VS Code assistants).
 *
 * @remarks
 * Feature-detected: a VS Code older than 1.101 has no MCP API, and then nothing is registered and nothing fails. The
 * server definition follows the session, so a changed CLI location is picked up without a reload. The provider id
 * `mnci.mcp` is declared in `package.json` under `mcpServerDefinitionProviders`.
 *
 * @param session - The CLI's cached answers.
 * @returns What to dispose when the extension deactivates.
 * @throws Never - an editor without the API gets no server.
 * @typeParam None - this function has no generic type parameters.
 */
export function registerMcpServer (session: CliSession): vscode.Disposable[] {
  const api = vscode as unknown as McpApi
  const register = api.lm?.registerMcpServerDefinitionProvider
  const Definition = api.McpStdioServerDefinition
  if (register === undefined || Definition === undefined) {
    return []
  }
  const changed = new vscode.EventEmitter<void>()
  const unsubscribe = session.onDidChange(() => { changed.fire() })
  const provider = register.call(api.lm, 'mnci.mcp', {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions:     () => {
      const launch = mcpServerLaunch(session.location(), session.workspaceRoot)
      if (launch === undefined) {
        return []
      }
      const definition = new Definition(launch.label, launch.command, [...launch.args])
      definition.cwd = vscode.Uri.file(launch.cwd)

      return [definition]
    },
  })

  return [provider, changed, new vscode.Disposable(unsubscribe)]
}
