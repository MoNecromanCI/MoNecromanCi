/**
 * Reading a repository and judging what adopting it into mnci would involve (the report `mnci adopt` prints).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export type { AdoptionFinding, AdoptionReport, FindingSeverity, FoundProject, RepositoryFacts } from './adoption-report.contract'
export { reportAdoption } from './report-adoption.use-case'
