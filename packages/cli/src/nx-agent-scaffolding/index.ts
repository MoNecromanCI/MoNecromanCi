/**
 * Removing the AI-agent integration `create-nx-workspace` scaffolds, entry by entry (#423).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { removeNxAgentScaffolding, type AgentScaffoldingRemoval } from './remove-nx-agent-scaffolding.use-case'
