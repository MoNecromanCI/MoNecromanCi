import { runAudit } from './audit.use-case'
import type { CiDependencies } from './phase.contract'
import { runVerify } from './verify.use-case'

/**
 * Runs the audit gate, then the verify phase.
 *
 * @remarks
 * What `mnci ci verify` is. The audit gate is part of verifying: a run that passed here and then failed `npm audit` in CI had
 * verified nothing that mattered. It goes first because it takes seconds, and a known advisory should not wait behind a
 * build. The `audit` phase stays on its own for the pipelines that run it as a separate step.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The environment, the process runner and the logger; real ones by default.
 * @returns The audit's status when it failed, otherwise the verification's.
 * @throws Never - a command that fails is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export function runVerifyWithAudit (workspaceRoot: string, dependencies: Partial<CiDependencies> = {}): number {
  const audited = runAudit(workspaceRoot, dependencies)

  return audited === 0 ? runVerify(workspaceRoot, dependencies) : audited
}
