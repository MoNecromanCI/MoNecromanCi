/**
 * The phases of the pipeline, as commands: what `mnci ci <phase>` runs, and what a generated pipeline is
 * being moved to call.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only through this barrel.
 * Each phase is a port of the inline `node -e` guards the generated pipelines carry, so the
 * logic is testable TypeScript, versioned with the CLI, and the same command runs on a
 * developer's machine as in CI.
 */

import { runPack } from './pack.use-case'
import { runVerify } from './verify.use-case'
import type { CiDependencies } from './phase.contract'

/**
 * The phases that exist.
 *
 * @remarks
 * More arrive as their guards are ported from the generated pipelines. The order is the one
 * the pipeline runs them in: `verify` gates every run; `pack` builds, on main, the per-app
 * artifacts a release then publishes.
 */
export const CI_PHASES = ['verify', 'pack'] as const

/**
 * One of {@link CI_PHASES}.
 *
 * @remarks
 * Derived from the list, so adding a phase there is the only edit that makes it a valid name.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type CiPhase = typeof CI_PHASES[number]

/**
 * Runs one phase of the pipeline.
 *
 * @remarks
 * The single entry point `mnci ci <phase>` calls, so the command line and the tests reach a
 * phase the same way.
 *
 * @param phase - Which phase.
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - Overrides for the environment, the process runner and the logger, for tests.
 * @returns The phase's exit status.
 * @throws Never - a failing command is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export function runCiPhase (phase: CiPhase, workspaceRoot: string, dependencies: Partial<CiDependencies> = {}): number {
  switch (phase) {
    case 'verify': {
      return runVerify(workspaceRoot, dependencies)
    }
    case 'pack': {
      return runPack(workspaceRoot, dependencies)
    }
  }
}

export { detectCiHost, groupEnd, groupStart, pullRequestTarget, type CiHost } from './ci-environment.client'
export type { CiDependencies, CiProcesses } from './phase.contract'
