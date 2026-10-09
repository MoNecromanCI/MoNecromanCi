/**
 * The assistants and the MCP registration mnci prepares in a workspace.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { writeMnciAgents } from './write-mnci-agents.use-case'
export { MNCI_AGENTS, MNCI_MCP_CONFIG, type MnciAgent } from './mnci-agents.config'
