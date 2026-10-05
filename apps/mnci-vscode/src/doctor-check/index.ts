/**
 * Running `mnci doctor` and showing what it found in the Problems panel.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export type { DoctorProblem } from './doctor-findings.mapper'
export { runDoctorCheck, type DoctorSurface } from './run-doctor-check.use-case'
