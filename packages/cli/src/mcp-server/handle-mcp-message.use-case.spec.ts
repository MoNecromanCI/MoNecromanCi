import { handleMcpMessage, MCP_PROTOCOL_VERSIONS, type McpServerContext, type McpToolResult } from './handle-mcp-message.use-case'
import { MCP_TOOLS } from './mcp-tool-catalog.config'

/** A context whose runner records the arguments it was given. */
function context (outcome?: McpToolResult): McpServerContext & { ran: string[][] } {
  const ran: string[][] = []

  return {
    tools:   MCP_TOOLS,
    version: '9.9.9',
    ran,
    run:     async (arguments_) => {
      ran.push(arguments_)

      return outcome ?? { text: 'ok', isError: false }
    },
  }
}

describe('handleMcpMessage (#292)', () => {
  it('answers initialize with the version the client asked for, when it is known', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, context())

    expect(response?.result).toMatchObject({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mnci', version: '9.9.9' } })
  })

  it('answers initialize with its newest version when the client asks for an unknown one', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, context())

    expect(response?.result).toMatchObject({ protocolVersion: MCP_PROTOCOL_VERSIONS[0] })
  })

  it('does not answer a notification', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, context())).toBeUndefined()
  })

  it('answers ping', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 'a', method: 'ping' }, context())

    expect(response).toEqual({ jsonrpc: '2.0', id: 'a', result: {} })
  })

  it('lists every tool with its schema, marking the ones that only read', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, context())
    const tools = (response?.result as { tools: Array<{ name: string, inputSchema: unknown, annotations: { readOnlyHint: boolean } }> }).tools

    expect(tools.map(tool => tool.name)).toEqual(MCP_TOOLS.map(tool => tool.name))
    expect(tools.find(tool => tool.name === 'mnci_doctor')?.annotations.readOnlyHint).toBe(true)
    expect(tools.find(tool => tool.name === 'mnci_add_project')?.annotations.readOnlyHint).toBe(false)
    expect(tools.every(tool => typeof tool.inputSchema === 'object')).toBe(true)
  })

  it('runs the command a tool maps to and returns its output', async () => {
    const setup = context({ text: '[{"name":"api"}]', isError: false })

    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mnci_projects', arguments: {} } }, setup)

    expect(setup.ran).toEqual([['projects', '--json']])
    expect(response?.result).toEqual({ content: [{ type: 'text', text: '[{"name":"api"}]' }], isError: false })
  })

  it('reports a failed command as an error result the model can read', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mnci_sync', arguments: { check: true } } }, context({ text: 'drift', isError: true }))

    expect(response?.result).toEqual({ content: [{ type: 'text', text: 'drift' }], isError: true })
  })

  it('refuses input that could be read as an option, without running anything', async () => {
    const setup = context()

    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mnci_add_project', arguments: { kind: 'npm-lib', name: '--force' } } }, setup)

    expect(setup.ran).toEqual([])
    expect(response?.result).toMatchObject({ isError: true })
  })

  it('answers an unknown tool and an unknown method with a protocol error', async () => {
    const unknownTool = await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }, context())
    const unknownMethod = await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, context())

    expect(unknownTool?.error?.code).toBe(-32602)
    expect(unknownMethod?.error?.code).toBe(-32601)
  })
})

const argumentsOf = (name: string, input: Record<string, unknown>): string[] => (MCP_TOOLS.find(tool => tool.name === name)?.arguments_(input) ?? [])

describe('the tools\' commands', () => {
  it('builds `add` with its flags', () => {
    expect(argumentsOf('mnci_add_project', { kind: 'go-app', name: 'api', release: true, web: 'site' })).toEqual(['add', 'go-app', 'api', '--web', 'site', '--release'])
  })

  it('builds `install` with one -w per project', () => {
    expect(argumentsOf('mnci_install', { package: 'zod', projects: ['api', 'apps/web'], dev: true })).toEqual(['install', '-D', '-w', 'api', '-w', 'apps/web', 'zod'])
  })

  it('refuses an install with no project, because a dependency never belongs to the root', () => {
    expect(() => argumentsOf('mnci_install', { package: 'zod', projects: [] })).toThrow(/at least one project/)
  })

  it('builds `pipeline` with and without a template', () => {
    expect(argumentsOf('mnci_pipeline', {})).toEqual(['pipeline'])
    expect(argumentsOf('mnci_pipeline', { template: 'deploy-pages', project: 'site', ci: 'github' })).toEqual(['pipeline', 'deploy-pages', '--project', 'site', '--ci', 'github'])
  })
})
