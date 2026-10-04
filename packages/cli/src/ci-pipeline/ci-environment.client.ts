/**
 * Where a pipeline phase is running.
 *
 * @remarks
 * `local` is a developer's machine: no provider variable is set, so the phase prints plain
 * headings instead of provider log markers.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type CiHost = 'github' | 'azure' | 'local'

/**
 * Which CI provider is running this process.
 *
 * @remarks
 * Read from the variables each provider sets on every run, not asked of the user, so the
 * same command prints the right log markers in a pipeline and plain lines on a laptop.
 *
 * @param environment - The process environment.
 * @returns `github` under GitHub Actions, `azure` under Azure Pipelines, else `local`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function detectCiHost (environment: NodeJS.ProcessEnv): CiHost {
  if (environment.GITHUB_ACTIONS === 'true') {
    return 'github'
  }
  if (environment.TF_BUILD !== undefined && environment.TF_BUILD !== '') {
    return 'azure'
  }

  return 'local'
}

/**
 * The branch a pull request targets, when this run is one.
 *
 * @remarks
 * The two providers name it differently, so both are read: GitHub sets
 * `GITHUB_BASE_REF` (an empty string on a push, which is "not a pull request"), and Azure
 * sets `SYSTEM_PULLREQUEST_TARGETBRANCH`, as a full `refs/heads/...` path. Nothing sets
 * either on a push to main, so a release run always verifies everything: that falls out of
 * the absence rather than being a second condition to keep in step.
 *
 * @param environment - The process environment.
 * @returns The bare branch name, or `undefined` when this is not a pull request.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function pullRequestTarget (environment: NodeJS.ProcessEnv): string | undefined {
  const reference = environment.GITHUB_BASE_REF || environment.SYSTEM_PULLREQUEST_TARGETBRANCH || ''

  return reference === '' ? undefined : reference.replace('refs/heads/', '')
}

/**
 * The line that opens a collapsible group in the provider's log.
 *
 * @remarks
 * A phase is one step in the pipeline, so what used to be separate steps in the UI becomes
 * groups inside it: the failing part is one click away instead of lost in a wall of output.
 *
 * @param host - Where the phase is running.
 * @param title - The group's heading.
 * @returns The marker line for that provider, or a plain heading locally.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function groupStart (host: CiHost, title: string): string {
  switch (host) {
    case 'github': {
      return `::group::${title}`
    }
    case 'azure': {
      return `##[group]${title}`
    }
    case 'local': {
      return `\n▸ ${title}`
    }
  }
}

/**
 * The line that closes the group {@link groupStart} opened.
 *
 * @remarks
 * Only the providers have a closing marker. Locally a heading needs no closing, so there is
 * nothing to print, and `undefined` tells the caller to print nothing.
 *
 * @param host - Where the phase is running.
 * @returns The marker line, or `undefined` locally, where a heading needs no closing.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function groupEnd (host: CiHost): string | undefined {
  switch (host) {
    case 'github': {
      return '::endgroup::'
    }
    case 'azure': {
      return '##[endgroup]'
    }
    case 'local': {
      return undefined
    }
  }
}
