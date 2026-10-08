import type { AdoptionReport } from './adoption-report.contract'
import { inspectRepository } from './inspect-repository.use-case'
import { judgeAdoption } from './judge-adoption.policy'

/**
 * Reads a repository and says what adopting it into mnci would involve.
 *
 * @remarks
 * Pure of side effects: it reads git and the filesystem and prints nothing, so a test or an editor can call it.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @returns The report.
 * @throws Error when a manifest it must read is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function reportAdoption (repositoryRoot: string): AdoptionReport {
  return judgeAdoption(inspectRepository(repositoryRoot))
}
