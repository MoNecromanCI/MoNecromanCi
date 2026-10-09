/**
 * An MCP server over the CLI, so an AI assistant can inspect and change a workspace through mnci (`mnci mcp`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { handleMcpMessage, MCP_PROTOCOL_VERSIONS, type JsonRpcResponse, type McpServerContext, type McpToolResult } from './handle-mcp-message.use-case'
export { MCP_TOOLS, type McpTool } from './mcp-tool-catalog.config'
export { serveMcp } from './serve-mcp.use-case'
