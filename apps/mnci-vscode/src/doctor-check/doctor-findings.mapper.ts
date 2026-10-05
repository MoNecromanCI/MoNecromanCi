import type { DoctorReport } from '../cli-contracts'

/**
 * A failed check, ready to show in the Problems panel.
 *
 * @remarks
 * `remedy` is the CLI's own instruction for fixing it, which becomes related information.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DoctorProblem {
  readonly message: string
  readonly remedy?: string
}

/**
 * Picks the failed checks out of a report.
 *
 * @remarks
 * A check that passed produces nothing: the Problems panel lists only what needs attention.
 *
 * @param report - What `mnci doctor --json` returned.
 * @returns One problem per failed check; a passing check is not a problem.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
export function doctorProblems (report: DoctorReport): DoctorProblem[] {
  return report.findings
    .filter(finding => !finding.ok)
    .map(finding => ({
      message: finding.detail ? `${finding.check}: ${finding.detail}` : finding.check,
      remedy:  finding.remedy,
    }))
}

/**
 * Summarises a report in one line.
 *
 * @remarks
 * Shown as the message after a run, beside the button that opens the Problems panel.
 *
 * @param report - What `mnci doctor --json` returned.
 * @returns For example `mnci doctor: 10 passed, 2 failed`.
 * @throws Never - pure formatting.
 * @typeParam None - this function has no generic type parameters.
 */
export function doctorSummary (report: DoctorReport): string {
  return report.failed === 0
    ? `mnci doctor: all ${report.passed} checks passed`
    : `mnci doctor: ${report.passed} passed, ${report.failed} failed`
}
