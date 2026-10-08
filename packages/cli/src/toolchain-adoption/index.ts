/**
 * Bringing a repository's toolchain to what mnci supports: retired tooling gone, one Nx version, an audit that passes.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { adoptToolchain, type ToolchainDependencies, type ToolchainOptions, type ToolchainResult } from './adopt-toolchain.use-case'
