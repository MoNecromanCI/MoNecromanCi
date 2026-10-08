import { logger, printJson } from '../terminal'
import type { AdoptionReport } from './adoption-report.contract'
import { inspectRepository } from './inspect-repository.use-case'
import { judgeAdoption } from './judge-adoption.policy'

/**
 * Flags of `mnci adopt`.
 *
 * @remarks
 * Only the report exists so far; later steps add their own flags.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface AdoptOptions {
  /** Print the report as one JSON document, for an editor or a script. */
  json?: boolean
}

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

/**
 * Prints the adoption report. Read-only.
 *
 * @remarks
 * Exits non-zero (`process.exitCode`, so output is never cut short) when a blocker stands in the way,
 * the same contract as `mnci doctor`. With `--json`, stdout is the report and nothing else.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Error when a manifest it must read is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function runAdopt (repositoryRoot: string, options: AdoptOptions = {}): void {
  const report = reportAdoption(repositoryRoot)
  if (!report.ready) {
    process.exitCode = 1
  }
  if (options.json === true) {
    printJson(report)

    return
  }
  const { facts } = report
  logger.info(`${facts.projects.length} project(s), ${facts.tagCount} tag(s), ${facts.packageManager ?? 'no lockfile'}, nx ${facts.nxVersion ?? 'not installed'}`)
  for (const finding of report.findings) {
    const line = `${finding.severity === 'blocker' ? 'BLOCKER' : 'warning'}: ${finding.detail}\n    next: ${finding.step}`
    if (finding.severity === 'blocker') {
      logger.error(line)
    } else {
      logger.warn(line)
    }
  }
  if (report.ready) {
    logger.success('Nothing blocks adoption. This was a read-only report; nothing was changed.')
  } else {
    logger.error('Adoption is blocked. Clear the blockers above and run the report again.')
  }
}
