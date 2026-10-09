/**
 * Whether a file or directory name is one Nx writes for its AI-agent integration.
 *
 * @remarks
 * Nx's agent scaffolding is recognisable by name: the CI monitor (`ci-monitor-subagent`, `monitor-ci`), the workspace
 * package linker (`link-workspace-packages`) and the `nx-*` skills (`nx-generate`, `nx-import`, `nx-workspace`, ...).
 * A name matches with or without an extension, so `monitor-ci.prompt.md` and `ci-monitor-subagent.toml` do.
 *
 * @param name - One path segment.
 * @returns True when Nx writes an entry with that name.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isNxAuthoredName (name: string): boolean {
  return /^(?:ci-monitor-subagent|monitor-ci|link-workspace-packages|nx-[\w-]+)(?:\.[\w.-]+)?$/u.test(name)
}

/** Domains Nx's sandbox allow-list names. */
function isNxSandboxDomain (domain: string): boolean {
  return domain === 'www.google-analytics.com' || /(?:^|\.)nx\.(?:app|dev)$/u.test(domain)
}

/**
 * Whether every key of an object is one of the allowed ones.
 *
 * @param value - Anything.
 * @param allowed - The keys it may have.
 * @returns True for a plain object whose keys are all allowed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function hasOnlyKeys (value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))
}

/**
 * Parses JSON text.
 *
 * @param text - Text that may be JSON.
 * @returns The value, or `undefined` when it is not valid JSON (a comment makes it so).
 * @throws Never - invalid text is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
function parseJson (text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Whether Nx's `.claude/settings.json` holds only what Nx put there.
 *
 * @remarks
 * Nx registers its plugin marketplace and a sandbox allow-list. A key anything else added (a permission, another
 * plugin, a different domain) means the file is also the user's, and it is kept.
 *
 * @param text - The file's text.
 * @returns True when nothing in it is the user's.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function isNxClaudeSettings (text: string): boolean {
  const settings = parseJson(text)
  if (!hasOnlyKeys(settings, ['extraKnownMarketplaces', 'enabledPlugins', 'sandbox'])) {
    return false
  }
  const marketplaces = settings.extraKnownMarketplaces
  const plugins = settings.enabledPlugins
  const sandbox = settings.sandbox
  const network = hasOnlyKeys(sandbox, ['network']) ? sandbox.network : undefined
  const domains = hasOnlyKeys(network, ['allowedDomains']) ? network.allowedDomains : undefined

  return (marketplaces === undefined || (typeof marketplaces === 'object' && marketplaces !== null && Object.keys(marketplaces).every(key => key.startsWith('nx')))) &&
    (plugins === undefined || (typeof plugins === 'object' && plugins !== null && Object.keys(plugins).every(key => key.startsWith('nx@')))) &&
    (sandbox === undefined || (Array.isArray(domains) && domains.every(domain => typeof domain === 'string' && isNxSandboxDomain(domain))))
}

/**
 * Whether a JSON config registers only Nx's MCP server.
 *
 * @param text - The file's text.
 * @param container - The key that holds the servers (`mcp` or `mcpServers`).
 * @param others - Other top-level keys Nx writes alongside it.
 * @returns True when the servers are exactly `nx-mcp` and the file has nothing else.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function isNxMcpOnly (text: string, container: string, others: readonly string[]): boolean {
  const config = parseJson(text)

  return hasOnlyKeys(config, [container, ...others]) && hasOnlyKeys(config[container], ['nx-mcp'])
}

/**
 * Whether Nx's `.codex/config.toml` holds only Nx's tables.
 *
 * @param text - The file's text.
 * @returns True when every table is one Nx writes and its MCP server is among them.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function isNxCodexConfig (text: string): boolean {
  const tables = Array.from(text.matchAll(/^\s*\[([^\]]+)\]\s*$/gmu), match => match[1].trim())

  return tables.includes('mcp_servers.nx-mcp') && tables.every(table => ['mcp_servers.nx-mcp', 'features', 'agents.ci-monitor-subagent'].includes(table))
}

/**
 * Whether a config file that Nx writes in full still holds only what Nx wrote.
 *
 * @remarks
 * These four are where a person is most likely to have added their own settings, so they are removed by what they
 * contain, not by where they are.
 *
 * @param path - The workspace-relative path with forward slashes.
 * @param text - The file's text.
 * @returns True when the file is recognisably Nx's alone; false when it has anything else, or is not one of the four.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isNxOnlyConfig (path: string, text: string): boolean {
  switch (path) {
    case '.claude/settings.json': {
      return isNxClaudeSettings(text)
    }
    case '.gemini/settings.json': {
      return isNxMcpOnly(text, 'mcpServers', ['contextFileName'])
    }
    case 'opencode.json': {
      return isNxMcpOnly(text, 'mcp', ['$schema'])
    }
    case '.codex/config.toml': {
      return isNxCodexConfig(text)
    }
    default: {
      return false
    }
  }
}

/**
 * The config files {@link isNxOnlyConfig} judges.
 *
 * @remarks
 * Kept in one place so the walker and the judge cannot disagree about which files are decided by content.
 */
export const NX_CONFIG_FILES: readonly string[] = ['.claude/settings.json', '.gemini/settings.json', 'opencode.json', '.codex/config.toml']
