import { runRelease } from '../ci-pipeline'
import { runCapture } from '../nx-workspace'
import {
  locateStrandedReleaseTags,
  locateTagsBehindRegistry,
  locateUntaggedPublished,
} from '../release-tag-lineage'
import { logger, promptConfirm } from '../terminal'
import { assessRelease, type ReleaseFindings } from './release-readiness.algorithm'

/**
 * Flags of `mnci release`.
 *
 * @remarks
 * Both are optional; with neither, the release is shown, confirmed and then made.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ReleaseOptions {
  /** Show what would be released and change nothing. */
  dryRun?: boolean
  /** Release without asking, which a run with no terminal needs. */
  yes?:    boolean
}

/**
 * What a release needs from outside; the real thing by default.
 *
 * @remarks
 * Injected so every branch is testable without a repository, a registry or a terminal.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ReleaseDependencies {
  git:         (arguments_: string[]) => { status: number, stdout: string }
  findings:    () => Omit<ReleaseFindings, 'branch' | 'tagsFetched'>
  plan:        (dryRun: boolean) => Promise<number>
  confirm:     (message: string) => Promise<boolean>
  interactive: boolean
}

/**
 * The real dependencies, rooted at one workspace.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The dependencies.
 * @throws Never - construction only.
 * @typeParam None - this function has no generic type parameters.
 */
function realDependencies (workspaceRoot: string): ReleaseDependencies {
  return {
    git:      arguments_ => runCapture('git', arguments_, workspaceRoot),
    findings: () => ({
      stranded: locateStrandedReleaseTags(workspaceRoot),
      behind:   locateTagsBehindRegistry(workspaceRoot),
      untagged: locateUntaggedPublished(workspaceRoot),
    }),
    plan:        async dryRun => await runRelease(workspaceRoot, {}, { dryRun }),
    confirm:     async message => await promptConfirm(message, false),
    interactive: process.stdin.isTTY && process.stdout.isTTY,
  }
}

/**
 * Previews or makes a release of every releasable project, in every language.
 *
 * @remarks
 * `mnci release --dry-run` fetches the tags, checks the three ways a project's last release goes missing (tags under an old
 * name, a published package with no tag, a tag behind the registry), and only when those are clear shows what `nx release`
 * would version, tag and publish, the Go libraries included, with nothing changed. A plain `mnci release` runs the same
 * check, shows the same plan, asks, and then runs the release phase CI runs. It refuses off `main`, and with no terminal it
 * needs `--yes`. Exits non-zero on a blocker, so it can sit in a script.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param options - The command's flags.
 * @param dependencies - Git, the checks, the plan and the prompt; the real ones by default.
 * @returns The exit status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
export async function releaseWorkspace (
  workspaceRoot: string,
  options: ReleaseOptions,
  dependencies: ReleaseDependencies = realDependencies(workspaceRoot),
): Promise<number> {
  const dryRun = options.dryRun === true
  const fetched = dependencies.git(['fetch', '--tags', '--force', '--quiet'])
  const head = dependencies.git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = head.status === 0 && head.stdout.trim() !== 'HEAD' ? head.stdout.trim() : undefined
  const readiness = assessRelease({ ...dependencies.findings(), branch, tagsFetched: fetched.status === 0 }, dryRun)

  for (const warning of readiness.warnings) {
    logger.warn(warning)
  }
  if (readiness.blockers.length > 0) {
    for (const blocker of readiness.blockers) {
      logger.error(blocker)
    }
    logger.info(dryRun
      ? 'No plan is shown: with these unresolved it would propose versions that are already published or far below them.'
      : 'Nothing was released.')

    return 1
  }

  logger.step(dryRun ? 'What a release would do (nothing is changed)' : 'What this release will do')
  const planned = await dependencies.plan(true)
  if (dryRun || planned !== 0) {
    return planned
  }
  if (options.yes !== true) {
    if (!dependencies.interactive) {
      logger.error('There is no terminal to confirm in: pass --yes to release.')

      return 1
    }
    if (!await dependencies.confirm('Version, tag and publish the above?')) {
      logger.info('Nothing was released.')

      return 0
    }
  }

  return await dependencies.plan(false)
}
