import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { namesMnciServer } from './mcp-config-file.algorithm'

/**
 * Whether the workspace has the mnci MCP server registered for an assistant.
 *
 * @remarks
 * `registered`: `.mcp.json` (Claude Code) or `.vscode/mcp.json` (VS Code) names an `mnci` server.
 * `not-registered`: neither does, so an assistant in this workspace cannot use mnci until it is added.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type McpStatus = 'registered' | 'not-registered'

/**
 * Reads whether the workspace registers the mnci MCP server.
 *
 * @remarks
 * Reads the two files assistants look at; it does not start the server or ask the editor whether it is running.
 *
 * @param workspaceRoot - Absolute path of the workspace.
 * @returns The status.
 * @throws Never - an unreadable file names nothing.
 * @typeParam None - this function has no generic type parameters.
 */
export function readMcpStatus (workspaceRoot: string): McpStatus {
  const files = [join(workspaceRoot, '.mcp.json'), join(workspaceRoot, '.vscode', 'mcp.json')]
  const registered = files.some(file => {
    try {
      return namesMnciServer(readFileSync(file, 'utf8'))
    } catch {
      return false
    }
  })

  return registered ? 'registered' : 'not-registered'
}
