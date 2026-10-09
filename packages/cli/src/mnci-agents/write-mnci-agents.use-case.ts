import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { MNCI_AGENTS, MNCI_MCP_CONFIG } from './mnci-agents.config'

/**
 * Writes the assistants mnci prepares for a workspace, and registers its MCP server (#366).
 *
 * @remarks
 * `.claude/agents/<name>.md` for the wizard (architect), the necromancer (drives mnci) and the sorcerer (writer), and `.mcp.json`
 * so an assistant that reads it can start `npx mnci mcp`. They are written once and are the team's from then on: a file that
 * already exists is left exactly as it is, so a team's edits survive every `mnci upgrade`, and so does a `.mcp.json` that
 * registers other servers.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The workspace-relative paths written.
 * @throws Propagates any Node.js `fs` error raised while writing.
 * @typeParam None - this function has no generic type parameters.
 */
export function writeMnciAgents (workspaceRoot: string): string[] {
  const files = [
    ...MNCI_AGENTS.map(agent => ({ path: `.claude/agents/${agent.name}.md`, text: agent.text })),
    { path: '.mcp.json', text: MNCI_MCP_CONFIG },
  ]
  const written: string[] = []
  for (const file of files) {
    if (fileExists(join(workspaceRoot, file.path))) {
      continue
    }

    writeFileEnsured(join(workspaceRoot, file.path), file.text)
    written.push(file.path)
  }

  return written
}
