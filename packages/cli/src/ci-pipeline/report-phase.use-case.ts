import { appendFileSync } from 'node:fs'
import { detectCiHost } from './ci-environment.client'
import { describePhaseOutcome } from './phase-timing.algorithm'
import type { CiDependencies } from './phase.contract'

/**
 * Runs a phase and reports how long it took and how it ended.
 *
 * @remarks
 * Every phase gets the same treatment from here, so none has to time itself: a closing line in
 * the step's log, an annotation naming the phase when it failed, and a line on the GitHub run's
 * summary page. A phase that throws is reported as failed and the error is passed on, so a bug
 * is never hidden behind the timing.
 *
 * @param phase - The phase's name.
 * @param run - Starts the phase.
 * @param dependencies - The environment and logger, and the clock, for tests.
 * @returns The phase's exit status.
 * @throws Error when the phase itself throws, after reporting it.
 * @typeParam None - this function has no generic type parameters.
 */
export async function reportPhase (
  phase: string,
  run: () => number | Promise<number>,
  dependencies: Partial<CiDependencies> = {},
): Promise<number> {
  const environment = dependencies.environment ?? process.env
  const log = dependencies.log ?? ((message: string) => { console.log(message) })
  const clock = dependencies.clock ?? (() => Date.now())
  const host = detectCiHost(environment)
  const started = clock()

  const finish = (status: number): void => {
    const outcome = describePhaseOutcome(host, phase, status, clock() - started)
    log(outcome.log)
    if (outcome.annotation !== undefined) {
      log(outcome.annotation)
    }
    if (host === 'github' && environment.GITHUB_STEP_SUMMARY) {
      appendFileSync(environment.GITHUB_STEP_SUMMARY, `${outcome.summary}\n`)
    }
  }

  try {
    const status = await run()
    finish(status)

    return status
  } catch (error) {
    finish(1)
    throw error
  }
}
