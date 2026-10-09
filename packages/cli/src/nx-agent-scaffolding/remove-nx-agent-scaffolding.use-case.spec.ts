import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { removeNxAgentScaffolding } from './remove-nx-agent-scaffolding.use-case'

let root: string

/** Writes a file under the workspace. */
function write (file: string, content = 'x'): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), content)
}

/** Whether a workspace-relative path exists. */
function exists (file: string): boolean {
  return existsSync(join(root, file))
}

const NX_CLAUDE = JSON.stringify({
  extraKnownMarketplaces: { 'nx-claude-plugins': { source: { source: 'github', repo: 'nrwl/nx-ai-agents-config' } } },
  enabledPlugins:         { 'nx@nx-claude-plugins': true },
  sandbox:                { network: { allowedDomains: ['www.google-analytics.com'] } },
})
const NX_CODEX = '[mcp_servers.nx-mcp]\ncommand = "npx"\n\n[features]\nmulti_agent = true\n\n[agents.ci-monitor-subagent]\ndescription = "x"\n'

/** Lays out what `create-nx-workspace` writes, as measured on 23.3.0. */
function nxScaffold (): void {
  write('.claude/settings.json', NX_CLAUDE)
  write('.github/agents/ci-monitor-subagent.agent.md')
  write('.github/prompts/monitor-ci.prompt.md')
  write('.github/skills/monitor-ci/SKILL.md')
  write('.github/skills/monitor-ci/scripts/ci-poll-decide.mjs')
  write('.github/skills/nx-generate/SKILL.md')
  write('.github/skills/link-workspace-packages/SKILL.md')
  write('.agents/skills/nx-import/references/ESLINT.md')
  write('.codex/agents/ci-monitor-subagent.toml')
  write('.codex/config.toml', NX_CODEX)
  write('.cursor/agents/ci-monitor-subagent.md')
  write('.cursor/commands/monitor-ci.md')
  write('.cursor/skills/nx-workspace/SKILL.md')
  write('.gemini/commands/monitor-ci.toml')
  write('.gemini/settings.json', JSON.stringify({ mcpServers: { 'nx-mcp': { type: 'stdio' } }, contextFileName: 'AGENTS.md' }))
  write('.opencode/skills/nx-generate/SKILL.md')
  write('opencode.json', JSON.stringify({ mcp: { 'nx-mcp': { type: 'local' } } }))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-nx-agents-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('removeNxAgentScaffolding', () => {
  it('removes everything Nx writes, folders included, and reports each file', () => {
    nxScaffold()

    const { removed, kept } = removeNxAgentScaffolding(root)

    for (const folder of ['.claude', '.agents', '.codex', '.cursor', '.gemini', '.opencode', '.github/agents', '.github/prompts', '.github/skills']) {
      expect({ folder, exists: exists(folder) }).toEqual({ folder, exists: false })
    }
    expect(exists('opencode.json')).toBe(false)
    expect(kept).toEqual([])
    expect(removed).toEqual(expect.arrayContaining([
      '.claude/settings.json',
      '.github/agents/ci-monitor-subagent.agent.md',
      '.github/prompts/monitor-ci.prompt.md',
      '.codex/config.toml',
      'opencode.json',
    ]))
  })

  it('leaves the rest of .github alone, and removes the folders only because they are now empty', () => {
    nxScaffold()
    write('.github/workflows/ci.yml')
    write('.github/dependabot.yml')

    removeNxAgentScaffolding(root)

    expect(exists('.github/workflows/ci.yml')).toBe(true)
    expect(exists('.github/dependabot.yml')).toBe(true)
  })

  it("keeps a team's own agents, prompts and skills that share Nx's folders (#423)", () => {
    nxScaffold()
    write('.github/agents/security-reviewer.agent.md', 'mine')
    write('.github/prompts/review.prompt.md', 'mine')
    write('.github/skills/our-release/SKILL.md', 'mine')
    write('.cursor/rules/team.mdc', 'mine')
    write('.claude/agents/planner.md', 'mine')

    const { removed } = removeNxAgentScaffolding(root)

    for (const file of ['.github/agents/security-reviewer.agent.md', '.github/prompts/review.prompt.md', '.github/skills/our-release/SKILL.md', '.cursor/rules/team.mdc', '.claude/agents/planner.md']) {
      expect({ file, kept: exists(file), listed: removed.includes(file) }).toEqual({ file, kept: true, listed: false })
      expect(readFileSync(join(root, file), 'utf8')).toBe('mine')
    }
    // Nx's own entries beside them are gone.
    expect(exists('.github/agents/ci-monitor-subagent.agent.md')).toBe(false)
    expect(exists('.claude/settings.json')).toBe(false)
  })

  it('keeps a config file the team added to, and says so', () => {
    nxScaffold()
    write('.claude/settings.json', JSON.stringify({ ...JSON.parse(NX_CLAUDE) as object, permissions: { allow: ['Bash(npm run lint)'] } }))
    write('.codex/config.toml', `${NX_CODEX}\n[model]\nname = "ours"\n`)
    write('opencode.json', JSON.stringify({ mcp: { 'nx-mcp': {}, 'our-server': {} } }))

    const { removed, kept } = removeNxAgentScaffolding(root)

    expect(kept.toSorted((a, b) => a.localeCompare(b))).toEqual(['.claude/settings.json', '.codex/config.toml', 'opencode.json'])
    for (const file of kept) {
      expect(exists(file)).toBe(true)
      expect(removed).not.toContain(file)
    }
  })

  it('does nothing in a workspace that never had any of it, and is safe to run twice', () => {
    write('package.json', '{}')
    write('.github/workflows/ci.yml')

    expect(removeNxAgentScaffolding(root)).toEqual({ removed: [], kept: [] })

    nxScaffold()
    removeNxAgentScaffolding(root)

    expect(removeNxAgentScaffolding(root)).toEqual({ removed: [], kept: [] })
    expect(exists('package.json')).toBe(true)
  })
})
