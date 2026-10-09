import yaml from 'js-yaml'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MNCI_AGENTS } from './mnci-agents.config'
import { writeMnciAgents } from './write-mnci-agents.use-case'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-agents-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('writeMnciAgents (#366)', () => {
  it('writes the three agents and the MCP registration', () => {
    expect(writeMnciAgents(workspaceRoot)).toEqual(['.claude/agents/wizard.md', '.claude/agents/necromancer.md', '.claude/agents/sorcerer.md', '.mcp.json'])
    const registered: unknown = JSON.parse(readFileSync(join(workspaceRoot, '.mcp.json'), 'utf8'))

    expect(registered).toEqual({ mcpServers: { mnci: { command: 'npx', args: ['mnci', 'mcp'] } } })
  })

  it('gives every agent front matter that names it and says when to use it', () => {
    for (const agent of MNCI_AGENTS) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(agent.text)?.[1] ?? ''
      const parsed = yaml.load(front) as { name?: string, description?: string }

      expect(parsed.name).toBe(agent.name)
      expect(parsed.description).toMatch(/Use /)
    }
  })

  it('leaves a file the team already has exactly as it is, and writes the rest', () => {
    writeFileSync(join(workspaceRoot, '.mcp.json'), '{"mcpServers":{"other":{}}}')

    const written = writeMnciAgents(workspaceRoot)

    expect(written).not.toContain('.mcp.json')
    expect(readFileSync(join(workspaceRoot, '.mcp.json'), 'utf8')).toBe('{"mcpServers":{"other":{}}}')
    expect(existsSync(join(workspaceRoot, '.claude/agents/wizard.md'))).toBe(true)
    expect(writeMnciAgents(workspaceRoot)).toEqual([])
  })
})
