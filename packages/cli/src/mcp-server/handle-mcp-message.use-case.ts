import type { McpTool } from './mcp-tool-catalog.config'

/**
 * The protocol versions this server speaks, newest first.
 *
 * @remarks
 * A client asking for another is answered with the newest.
 */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

/**
 * What a tool run produced: the text the model reads, and whether the command failed.
 *
 * @remarks
 * See {@link McpServerContext}.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface McpToolResult {
  /** The command's output. */
  text:    string
  /** True when the command exited non-zero. */
  isError: boolean
}

/**
 * What {@link handleMcpMessage} needs from the outside.
 *
 * @remarks
 * The tools, the version and how to run a command.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface McpServerContext {
  /** The tools on offer. */
  tools:   readonly McpTool[]
  /** The version reported as the server's. */
  version: string
  /** Runs the `mnci` command a tool maps to. */
  run:     (arguments_: string[]) => Promise<McpToolResult>
}

/** A JSON-RPC message, as far as this server reads one. */
interface JsonRpcMessage {
  id?:     number | string | null
  method?: string
  params?: Record<string, unknown>
}

/**
 * A JSON-RPC response to send back.
 *
 * @remarks
 * Either a `result` or an `error`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id:      number | string | null
  result?: unknown
  error?:  { code: number, message: string }
}

/**
 * Answers one message of the Model Context Protocol, over the stdio transport.
 *
 * @remarks
 * Implements what a tools-only server needs: `initialize` (the client's protocol version is echoed when this server knows it),
 * `ping`, `tools/list` and `tools/call`; the `initialized` and other notifications get no answer. A tool that cannot run, or
 * whose input is refused, comes back as a result with `isError` set, not as a protocol error, so the model sees why and can
 * correct itself. An unknown method is a protocol error (`-32601`).
 *
 * @param message - The parsed JSON-RPC message.
 * @param context - The tools, the version and how to run a command.
 * @returns The response, or `undefined` for a notification.
 * @throws Never - a failing tool is a result.
 * @typeParam None - this function has no generic type parameters.
 */
export async function handleMcpMessage (message: unknown, context: McpServerContext): Promise<JsonRpcResponse | undefined> {
  const request = (typeof message === 'object' && message !== null ? message : {}) as JsonRpcMessage
  if (request.id === undefined) {
    return undefined
  }
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: request.id ?? null, result })
  const refuse = (code: number, text: string): JsonRpcResponse => ({ jsonrpc: '2.0', id: request.id ?? null, error: { code, message: text } })

  switch (request.method) {
    case 'initialize': {
      const asked = request.params?.protocolVersion
      const known = MCP_PROTOCOL_VERSIONS.find(version => version === asked)

      return reply({
        protocolVersion: known ?? MCP_PROTOCOL_VERSIONS[0],
        capabilities:    { tools: {} },
        serverInfo:      { name: 'mnci', version: context.version },
        instructions:    'mnci scaffolds and maintains an Nx monorepo. Start with mnci_projects and mnci_doctor to see the workspace; mnci_kinds lists what mnci_add_project can create.',
      })
    }
    case 'ping': {
      return reply({})
    }
    case 'tools/list': {
      return reply({
        tools: context.tools.map(tool => ({
          name:        tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
        })),
      })
    }
    case 'tools/call': {
      const tool = context.tools.find(each => each.name === request.params?.name)
      if (tool === undefined) {
        return refuse(-32602, `Unknown tool '${String(request.params?.name)}'.`)
      }
      try {
        const input = (request.params?.arguments ?? {}) as Record<string, unknown>
        const outcome = await context.run(tool.arguments_(input))

        return reply({ content: [{ type: 'text', text: outcome.text }], isError: outcome.isError })
      } catch (error) {
        return reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true })
      }
    }
    default: {
      return refuse(-32601, `Method not found: ${String(request.method)}`)
    }
  }
}
