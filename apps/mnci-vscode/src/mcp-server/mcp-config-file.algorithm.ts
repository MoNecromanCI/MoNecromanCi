/**
 * Whether the text of an MCP configuration file names the `mnci` server.
 *
 * @remarks
 * Claude Code's `.mcp.json` keeps servers under `mcpServers`; VS Code's `.vscode/mcp.json` under `servers`. Either counts.
 *
 * @param text - The file's text.
 * @returns `true` when a server called `mnci` is declared.
 * @throws Never - text that is not JSON names nothing.
 * @typeParam None - this function has no generic type parameters.
 */
export function namesMnciServer (text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) {
      return false
    }
    const document = parsed as Record<string, unknown>

    return ['mcpServers', 'servers'].some(key => {
      const servers = document[key]

      return typeof servers === 'object' && servers !== null && 'mnci' in servers
    })
  } catch {
    return false
  }
}

/**
 * Adds the mnci server to the text of a `.mcp.json`, keeping every other server.
 *
 * @remarks
 * The entry is the one `mnci new` writes (`npx mnci mcp`), so a file made either way reads the same. A file that already
 * names `mnci` is left exactly as it is, whatever it says: it is the team's.
 *
 * @param existing - The current text, or `undefined` when there is no file.
 * @returns The new text, whether it changed, and why when the file is not a JSON object (it is then left alone).
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function withMnciMcpServer (existing: string | undefined): { text: string, changed: boolean, problem?: string } {
  const entry = { command: 'npx', args: ['mnci', 'mcp'] }
  if (existing === undefined || existing.trim() === '') {
    return { text: `${JSON.stringify({ mcpServers: { mnci: entry } }, null, 2)}\n`, changed: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(existing)
  } catch {
    return { text: existing, changed: false, problem: 'it is not valid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { text: existing, changed: false, problem: 'it is not a JSON object' }
  }
  const document = parsed as { mcpServers?: unknown }
  const servers = typeof document.mcpServers === 'object' && document.mcpServers !== null ? document.mcpServers as Record<string, unknown> : {}
  if ('mnci' in servers) {
    return { text: existing, changed: false }
  }

  return { text: `${JSON.stringify({ ...document, mcpServers: { ...servers, mnci: entry } }, null, 2)}\n`, changed: true }
}
