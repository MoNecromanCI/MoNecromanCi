import type { CliLocation } from '../cli-access'

/**
 * How to start `mnci mcp`, as an editor's MCP client needs it.
 *
 * @remarks
 * The command and arguments of one stdio server, with the folder it must run in.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface McpServerLaunch {
  /** The name the client lists the server under. */
  readonly label:   string
  /** The executable to start. */
  readonly command: string
  /** Its arguments: the location's prefix, then `mcp`. */
  readonly args:    readonly string[]
  /** The workspace root, where the server must be started to see the projects. */
  readonly cwd:     string
}

/**
 * Decides how an editor starts the mnci MCP server.
 *
 * @remarks
 * Uses the same CLI the side bar and commands run (the workspace's own install, a global one, or npx at latest), so the
 * tools the assistant sees match the version the team works with.
 *
 * @param location - Where the CLI was found.
 * @param workspaceRoot - The open workspace folder, if any.
 * @returns The launch, or `undefined` when no folder is open (the server serves a workspace).
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function mcpServerLaunch (location: CliLocation, workspaceRoot: string | undefined): McpServerLaunch | undefined {
  if (workspaceRoot === undefined) {
    return undefined
  }

  return { label: 'MNCI', command: location.command, args: [...location.prefix, 'mcp'], cwd: workspaceRoot }
}
