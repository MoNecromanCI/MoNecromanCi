/**
 * Making the mnci MCP server easy to use from the editor, and showing whether it is set up.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { registerMcpServer } from './register-mcp-server.handler'
export { addMcpConfig, type AddMcpConfigResult } from './add-mcp-config.use-case'
export { readMcpStatus, type McpStatus } from './read-mcp-status.use-case'
