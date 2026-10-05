import type { CliSession } from '../cli-session'
import { doctorProblems, doctorSummary, type DoctorProblem } from './doctor-findings.mapper'

/**
 * What showing a doctor result needs from the editor.
 *
 * @remarks
 * `showProblems` replaces whatever the previous run showed; an empty list clears it.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DoctorSurface {
  readonly showProblems: (problems: readonly DoctorProblem[]) => void
  readonly tell:         (message: string, kind: 'info' | 'warning') => void
}

/**
 * Runs `mnci doctor` and shows the result in the Problems panel.
 *
 * @remarks
 * Each failed check becomes a problem carrying the CLI's own remedy, so the fix is one glance
 * away. A clean run clears the previous problems. The CLI exiting non-zero on a failed check
 * is an answer, not an error; only a CLI that printed nothing readable is.
 *
 * @param session - The session to ask.
 * @param surface - How to show problems and messages.
 * @returns Nothing.
 * @throws Error when the CLI cannot be run or prints no report.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runDoctorCheck (session: CliSession, surface: DoctorSurface): Promise<void> {
  const report = await session.doctor()
  surface.showProblems(doctorProblems(report))
  surface.tell(doctorSummary(report), report.failed === 0 ? 'info' : 'warning')
}
