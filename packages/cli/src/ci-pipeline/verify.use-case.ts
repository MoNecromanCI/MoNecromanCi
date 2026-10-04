import { runCapture, runShell, type CaptureResult } from '../nx-workspace'
import { GO_CGO_TAG, hasNativeGoApp, VERIFY_TARGETS } from '../workspace-overlay'
import { detectCiHost, groupEnd, groupStart, pullRequestTarget } from './ci-environment.client'

/** The processes a phase starts, injectable so every branch can be tested without a repository. */
export interface CiProcesses {
  /** Runs a command with its output going straight through, and returns its exit status. */
  run:     (command: string, arguments_: string[]) => number
  /** Runs a command and returns what it printed. */
  capture: (command: string, arguments_: string[]) => CaptureResult
}

/** What {@link runVerify} reads from outside: all of it defaults to the real thing. */
export interface VerifyDependencies {
  environment: NodeJS.ProcessEnv
  processes:   CiProcesses
  log:         (message: string) => void
}

/**
 * Runs the verify phase: the sync check, then every Nx target CI verifies.
 *
 * @remarks
 * Ported from the inline `node -e` guard the generated pipelines carry, branch for branch,
 * so that a pipeline switched over to `mnci ci verify` verifies exactly what it did. The
 * two ways to scope it, and the order:
 *
 * - **Not a pull request** (nothing names a target branch, which is a push to main):
 *   every project, so a release is always verified in full.
 * - **A pull request**: the projects affected since the merge-base with the target, found
 *   with `git merge-base`, never the provider's base-SHA field, which drifts once the
 *   target moves ahead. It tries `origin/<target>` first and, only if that ref is absent,
 *   fetches the target once and retries against `FETCH_HEAD`: both providers are
 *   configured for a full clone, so the ref is normally there, but if it is not, falling
 *   back silently would verify everything while looking selective, for ever.
 * - **Every fallback takes the full path**, because a run that verifies too little still
 *   reports green.
 *
 * Differs from the guard in two ways that cannot change a result. It runs `nx sync:check`
 * first, which the pipeline ran as a separate step before it, and it decides whether to
 * exclude native (cgo) apps when it runs, by looking for the tag, where the pipeline had it
 * decided when the file was written.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The environment, the process runner and the logger; real ones by default.
 * @returns The exit status: 0 when everything verified, otherwise the failing command's.
 * @throws Never - a command that fails is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export function runVerify (workspaceRoot: string, dependencies: Partial<VerifyDependencies> = {}): number {
  const environment = dependencies.environment ?? process.env
  const processes = dependencies.processes ?? {
    run:     (command, arguments_) => runShell(command, arguments_, workspaceRoot),
    capture: (command, arguments_) => runCapture(command, arguments_, workspaceRoot),
  }
  const log = dependencies.log ?? ((message: string) => { console.log(message) })
  const host = detectCiHost(environment)

  /** Runs one command inside a log group, so its output collapses in the provider's UI. */
  const inGroup = (title: string, command: string, arguments_: string[]): number => {
    log(groupStart(host, title))
    const status = processes.run(command, arguments_)
    const closing = groupEnd(host)
    if (closing !== undefined) {
      log(closing)
    }

    return status
  }

  const synced = inGroup('Verify the workspace is synced', 'npx', ['nx', 'sync:check'])
  if (synced !== 0) {
    log("The workspace is not synced: run 'npx nx sync' locally and commit the result.")

    return synced
  }

  const exclude = hasNativeGoApp(workspaceRoot) ? [`--exclude=tag:${GO_CGO_TAG}`] : []
  const everything = (): number => inGroup('Verify every project', 'npx', ['nx', 'run-many', '-t', VERIFY_TARGETS, ...exclude])
  const target = pullRequestTarget(environment)
  if (target === undefined) {
    log('Not a pull request - verifying EVERY project.')

    return everything()
  }

  const mergeBase = (reference: string): string => {
    const result = processes.capture('git', ['merge-base', reference, 'HEAD'])

    return result.status === 0 ? result.stdout.trim() : ''
  }
  let base = mergeBase(`origin/${target}`)
  if (base === '') {
    log(`No origin/${target} ref - fetching it to resolve a merge-base.`)
    processes.run('git', ['fetch', '--no-tags', 'origin', target])
    base = mergeBase('FETCH_HEAD')
  }
  if (base === '') {
    log(`Could not resolve a merge-base with ${target} - verifying EVERY project.`)

    return everything()
  }
  log(`Pull request against ${target} - verifying projects affected since ${base}`)

  return inGroup('Verify the affected projects', 'npx', ['nx', 'affected', '-t', VERIFY_TARGETS, `--base=${base}`, ...exclude])
}
