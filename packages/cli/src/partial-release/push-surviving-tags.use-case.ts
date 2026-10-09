import { failedPublishProjects, survivingTags } from './failed-publish.algorithm'

/**
 * The two things the recovery needs from the process runner.
 *
 * @remarks
 * Declared here rather than imported from `ci-pipeline`, which depends on this slice.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface TagPushProcesses {
  run:     (command: string, arguments_: string[]) => number
  capture: (command: string, arguments_: string[]) => { status: number, stdout: string }
}

/**
 * After a release that failed part way, pushes the tags of the packages that did publish.
 *
 * @remarks
 * Per-package, not all-or-nothing: a registry that refuses one package (a deleted version, a
 * rate limit, a permission) must not leave the others published and untagged, which makes the next
 * run propose their versions again and fail on each. The tags of the failed projects are held back
 * so the next run retries them. The run still fails; this only keeps the git state true to what
 * the registry holds. Does nothing when no publish task is named as failed (the failure came
 * earlier, so nothing was published) or when no tag was made.
 *
 * @param output - The combined output of the failed `nx release`.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns How many tags were pushed.
 * @throws Never - a failing git command is logged.
 * @typeParam None - this function has no generic type parameters.
 */
export function pushSurvivingTags (output: string, processes: TagPushProcesses, log: (message: string) => void): number {
  const failed = failedPublishProjects(output)
  if (failed.length === 0) {
    return 0
  }
  const listed = processes.capture('git', ['tag', '--points-at', 'HEAD'])
  const tags = listed.stdout.split(/\r?\n/).map(tag => tag.trim()).filter(tag => tag !== '')
  if (listed.status !== 0 || tags.length === 0) {
    return 0
  }
  const { push, held } = survivingTags(tags, failed)
  if (held.length > 0) {
    log(`Held back ${held.length} tag(s) - ${held.join(', ')} - so the next run retries them.`)
  }
  if (push.length === 0) {
    return 0
  }
  if (processes.run('git', ['push', 'origin', ...push.map(tag => `refs/tags/${tag}`)]) !== 0) {
    log('Pushing the tags of the packages that did publish failed - push them by hand, or the next run will try to publish the same versions again.')

    return 0
  }
  log(`Pushed ${push.length} tag(s) for the packages that published, although the release failed.`)

  return push.length
}
