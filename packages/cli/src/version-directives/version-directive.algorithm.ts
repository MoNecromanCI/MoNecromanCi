/**
 * The commit types that force a release version, in the order they are documented.
 *
 * @remarks
 * Every one is an alias of the same directive. They are also the extra `type-enum` entries the
 * generated commitlint config accepts, since `@commitlint/config-conventional` rejects a type it
 * does not know.
 */
export const VERSION_DIRECTIVE_TYPES = ['mnci-version', 'mnci-ver', 'mnci-force', 'mnci-v', 'version', 'ver', 'force', 'v'] as const

/**
 * A commit that asks for an exact release version of one project.
 *
 * @remarks
 * Written `version(<project>)[<version>]: <message>`, or with any alias of {@link VERSION_DIRECTIVE_TYPES}.
 * See {@link parseVersionDirective}.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface VersionDirective {
  /** The Nx project name, the one its release tags carry (`@scope/name` for a scoped package). */
  project: string
  /** The exact version to release, `major.minor.patch` with an optional prerelease. */
  version: string
}

const DIRECTIVE = new RegExp(String.raw`^(?:${VERSION_DIRECTIVE_TYPES.join('|')})\(([^()\s]+)\)\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]!?: \S`)

/**
 * Reads a commit subject as a version directive.
 *
 * @remarks
 * The subject must start with the directive, so a mention further along a line is not one.
 *
 * @param subject - The first line of a commit message.
 * @returns The project and version it names, or `undefined` for an ordinary commit.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function parseVersionDirective (subject: string): VersionDirective | undefined {
  const match = DIRECTIVE.exec(subject)

  return match === null ? undefined : { project: match[1], version: match[2] }
}

/**
 * Whether `version` is strictly above `base`, comparing `major.minor.patch` only.
 *
 * @param version - The candidate.
 * @param base - The version it must exceed.
 * @returns True when the candidate's core version is higher.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function isAbove (version: string, base: string): boolean {
  const a = version.split('-', 1)[0].split('.').map(Number)
  const b = base.split('-', 1)[0].split('.').map(Number)

  return ((a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2])) > 0
}

/**
 * Chooses the version each project is forced to.
 *
 * @remarks
 * `candidates` come newest first, so the first directive for a project wins. A directive at or below the project's
 * newest tag is dropped: the version is already released, or the request would move a project backwards, which a
 * registry refuses anyway.
 *
 * @param candidates - The directives of the commits not yet released, newest first.
 * @param tagged - The newest released version per project.
 * @returns At most one directive per project.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function pickVersionDirectives (candidates: readonly VersionDirective[], tagged: ReadonlyMap<string, string>): VersionDirective[] {
  const chosen: VersionDirective[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const base = tagged.get(candidate.project)
    if (!seen.has(candidate.project) && (base === undefined || isAbove(candidate.version, base))) {
      seen.add(candidate.project)
      chosen.push(candidate)
    }
  }

  return chosen
}

/**
 * The newest plain version a project is tagged with.
 *
 * @remarks
 * A prerelease or labelled tag is not a plain version and is skipped.
 *
 * @param tags - Every tag of the repository.
 * @param project - The project name the tags are written under (`<project>@<version>`).
 * @returns The highest `major.minor.patch` among them, or `undefined` when the project has none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function newestTaggedVersion (tags: readonly string[], project: string): string | undefined {
  let newest: string | undefined
  for (const tag of tags) {
    const version = tag.startsWith(`${project}@`) ? tag.slice(project.length + 1) : ''
    if (/^\d+\.\d+\.\d+$/.test(version) && (newest === undefined || isAbove(version, newest))) {
      newest = version
    }
  }

  return newest
}
