import { newestTaggedVersion, parseVersionDirective, pickVersionDirectives, VERSION_DIRECTIVE_TYPES, type VersionDirective } from './version-directive.algorithm'

/** Runs a command and returns its status and standard output; the shape `CiProcesses.capture` has. */
type Capture = (command: string, arguments_: string[]) => { status: number, stdout: string }

/**
 * Finds the version directives (#283) that no release has applied yet.
 *
 * @remarks
 * `git log --grep` finds the candidate commits in one call. A commit already reachable from its project's newest
 * tag was released with that tag, so only the commits after it count. Nx keeps deciding every other project's
 * version from the conventional commits as before.
 *
 * @param capture - Runs a git command in the workspace.
 * @returns At most one directive per project, newest commit first.
 * @throws Never - a failing git call reads as no directives.
 * @typeParam None - this function has no generic type parameters.
 */
export function locateVersionDirectives (capture: Capture): VersionDirective[] {
  const log = capture('git', ['log', '--extended-regexp', String.raw`--grep=^(${VERSION_DIRECTIVE_TYPES.join('|')})\(`, '--format=%H%x09%s'])
  if (log.status !== 0 || log.stdout.trim() === '') {
    return []
  }
  const tags = capture('git', ['tag', '--list'])
  const tagNames = tags.status === 0 ? tags.stdout.split(/\r?\n/).filter(Boolean) : []
  const commits = log.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, ...rest] = line.split('\t')

    return { hash, directive: parseVersionDirective(rest.join('\t')) }
  }).filter((commit): commit is { hash: string, directive: VersionDirective } => commit.directive !== undefined)

  const tagged = new Map<string, string>()
  for (const { directive } of commits) {
    const newest = newestTaggedVersion(tagNames, directive.project)
    if (newest !== undefined) {
      tagged.set(directive.project, newest)
    }
  }
  const pending = commits.filter(({ hash, directive }) => {
    const base = tagged.get(directive.project)

    return base === undefined || capture('git', ['merge-base', '--is-ancestor', hash, `${directive.project}@${base}`]).status !== 0
  })

  return pickVersionDirectives(pending.map(commit => commit.directive), tagged)
}
