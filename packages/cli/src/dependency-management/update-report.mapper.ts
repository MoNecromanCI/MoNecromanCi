import type { Outdated } from './outdated.contract'
import { releaseLink } from './release-link.algorithm'
import { UPDATE_KINDS } from './semver.algorithm'
import type { UpdateReport } from './update-report.contract'

/**
 * Converts what `mnci up` found into the document `--json` prints.
 *
 * @remarks
 * Ordered as the terminal report is: by section (patch, minor, major, non-semver), then by name, so an editor that
 * renders the list in order shows what the terminal would.
 *
 * @param outdated - Everything with an update available.
 * @returns The report.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function toUpdateReport (outdated: readonly Outdated[]): UpdateReport {
  const ordered = UPDATE_KINDS.flatMap(kind => outdated
    .filter(entry => entry.kind === kind)
    .toSorted((left, right) => left.name.localeCompare(right.name)))

  return {
    updates: ordered.map(entry => {
      const link = releaseLink(entry.ecosystem, entry.name, entry.latest)

      return {
        name:      entry.name,
        ecosystem: entry.ecosystem,
        kind:      entry.kind,
        current:   entry.current,
        latest:    entry.latest,
        ...(link !== undefined && { link }),
        projects:  [...new Set(entry.sites.map(site => site.project))].toSorted((left, right) => left.localeCompare(right)),
        sections:  [...new Set(entry.sites.map(site => site.section))].toSorted((left, right) => left.localeCompare(right)),
      }
    }),
  }
}
