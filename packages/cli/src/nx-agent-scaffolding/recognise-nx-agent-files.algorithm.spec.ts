import { isNxAuthoredName, isNxOnlyConfig } from './recognise-nx-agent-files.algorithm'

/** What `create-nx-workspace` writes to `.claude/settings.json`. */
const NX_CLAUDE = JSON.stringify({
  extraKnownMarketplaces: { 'nx-claude-plugins': { source: { source: 'github', repo: 'nrwl/nx-ai-agents-config' } } },
  enabledPlugins:         { 'nx@nx-claude-plugins': true },
  sandbox:                { network: { allowedDomains: ['www.google-analytics.com'] } },
})

describe('isNxAuthoredName', () => {
  it.each([
    'ci-monitor-subagent.agent.md',
    'ci-monitor-subagent.toml',
    'ci-monitor-subagent.md',
    'monitor-ci',
    'monitor-ci.prompt.md',
    'monitor-ci.toml',
    'link-workspace-packages',
    'nx-generate',
    'nx-import',
    'nx-run-tasks',
    'nx-workspace',
  ])('recognises %s as Nx\'s', name => {
    expect(isNxAuthoredName(name)).toBe(true)
  })

  it.each(['review.prompt.md', 'my-agent.md', 'security-review', 'next-steps.md', 'nxt.md', 'monitor.md', 'SKILL.md', 'README.md'])(
    'does not recognise %s',
    name => {
      expect(isNxAuthoredName(name)).toBe(false)
    },
  )
})

describe('isNxOnlyConfig: .claude/settings.json', () => {
  it('is Nx\'s when it holds the marketplace, the plugin and the sandbox allow-list', () => {
    expect(isNxOnlyConfig('.claude/settings.json', NX_CLAUDE)).toBe(true)
  })

  it('is not when the user added a key, a permission, another plugin or another domain', () => {
    const base = JSON.parse(NX_CLAUDE) as Record<string, unknown>

    expect(isNxOnlyConfig('.claude/settings.json', JSON.stringify({ ...base, permissions: { allow: ['Bash(npm run lint)'] } }))).toBe(false)
    expect(isNxOnlyConfig('.claude/settings.json', JSON.stringify({ ...base, enabledPlugins: { 'nx@nx-claude-plugins': true, 'mine@mine': true } }))).toBe(false)
    expect(isNxOnlyConfig('.claude/settings.json', JSON.stringify({ ...base, sandbox: { network: { allowedDomains: ['www.google-analytics.com', 'internal.example.com'] } } }))).toBe(false)
  })

  it('is not when it is not plain JSON, so a commented file is kept', () => {
    expect(isNxOnlyConfig('.claude/settings.json', `// mine\n${NX_CLAUDE}`)).toBe(false)
    expect(isNxOnlyConfig('.claude/settings.json', '')).toBe(false)
  })
})

describe('isNxOnlyConfig: the other tools\' config', () => {
  it('recognises a config that registers only the nx MCP server', () => {
    expect(isNxOnlyConfig('opencode.json', JSON.stringify({ mcp: { 'nx-mcp': { type: 'local', command: ['npx', 'nx', 'mcp'] } } }))).toBe(true)
    expect(isNxOnlyConfig('.gemini/settings.json', JSON.stringify({ mcpServers: { 'nx-mcp': {} }, contextFileName: 'AGENTS.md' }))).toBe(true)
  })

  it('does not when another server or key is there', () => {
    expect(isNxOnlyConfig('opencode.json', JSON.stringify({ mcp: { 'nx-mcp': {}, 'my-server': {} } }))).toBe(false)
    expect(isNxOnlyConfig('.gemini/settings.json', JSON.stringify({ mcpServers: { 'nx-mcp': {} }, theme: 'dark' }))).toBe(false)
  })

  it('recognises Codex config made only of Nx\'s tables, and not one with a table of the user\'s', () => {
    const nx = '[mcp_servers.nx-mcp]\ncommand = "npx"\n\n[features]\nmulti_agent = true\n\n[agents.ci-monitor-subagent]\ndescription = "x"\n'

    expect(isNxOnlyConfig('.codex/config.toml', nx)).toBe(true)
    expect(isNxOnlyConfig('.codex/config.toml', `${nx}\n[model]\nname = "mine"\n`)).toBe(false)
    expect(isNxOnlyConfig('.codex/config.toml', '[features]\nmulti_agent = true\n')).toBe(false)
  })

  it('judges only the four files it knows', () => {
    expect(isNxOnlyConfig('package.json', '{}')).toBe(false)
    expect(isNxOnlyConfig('.cursor/mcp.json', '{}')).toBe(false)
  })
})
