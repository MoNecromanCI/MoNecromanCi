import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withMnciMcpServer } from './mcp-config-file.algorithm'

/**
 * What came of adding the server to `.mcp.json`.
 *
 * @remarks
 * `unreadable` means the file exists and is not a JSON object, so it was left as it was.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type AddMcpConfigResult = 'written' | 'already-there' | 'unreadable'

/**
 * Registers `npx mnci mcp` in the workspace's `.mcp.json`, the file Claude Code reads.
 *
 * @remarks
 * Merges into an existing file and never replaces a server the team has. A file that is not JSON is left untouched and
 * reported, not overwritten.
 *
 * @param workspaceRoot - Absolute path of the workspace.
 * @returns What happened.
 * @throws Error when the file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addMcpConfig (workspaceRoot: string): AddMcpConfigResult {
  const path = join(workspaceRoot, '.mcp.json')
  const result = withMnciMcpServer(existsSync(path) ? readFileSync(path, 'utf8') : undefined)
  if (result.problem !== undefined) {
    return 'unreadable'
  }
  if (!result.changed) {
    return 'already-there'
  }
  writeFileSync(path, result.text)

  return 'written'
}
