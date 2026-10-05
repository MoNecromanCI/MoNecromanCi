import type { CiHost } from './ci-environment.client'

/**
 * Formats how long a phase took.
 *
 * @remarks
 * Seconds with one decimal under a minute, minutes and zero-padded seconds above, so a log line
 * reads the same at a glance whether a phase took three seconds or thirteen minutes.
 *
 * @param milliseconds - The elapsed time.
 * @returns For example `3.1s` or `1m 04s`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function formatDuration (milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const whole = Math.round(seconds)

  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}

/**
 * What a finished phase reports, for each place a reader might look.
 *
 * @remarks
 * The log line goes everywhere; the annotation and the summary line are the provider-specific extras.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PhaseOutcome {
  /** The line for the step's own log, on every host. */
  log:         string
  /** An annotation the provider pins to the run, present only when the phase failed. */
  annotation?: string
  /** A Markdown line for the run's summary page, where the host has one. */
  summary:     string
}

/**
 * Escapes the data of a GitHub workflow command, which reads `%`, CR and LF specially.
 *
 * @param text - The message.
 * @returns The message safe to put after `::error ...::`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function escapeCommandData (text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

/**
 * Describes how a phase ended, in the form each provider shows.
 *
 * @remarks
 * A failure gets an annotation, which GitHub lists on the run's summary and Azure on the build's
 * issues, so the failing phase is named without opening the log. A pass gets only the timing.
 *
 * @param host - Where the phase ran.
 * @param phase - The phase's name.
 * @param status - Its exit status.
 * @param milliseconds - How long it took.
 * @returns The log line, the annotation on failure, and the summary line.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function describePhaseOutcome (host: CiHost, phase: string, status: number, milliseconds: number): PhaseOutcome {
  const took = formatDuration(milliseconds)
  if (status === 0) {
    return {
      log:     `mnci ci ${phase}: passed in ${took}`,
      summary: `- ✅ **${phase}** passed in ${took}`,
    }
  }
  const message = `The ${phase} phase failed with exit status ${status} after ${took}`
  let annotation: string | undefined
  if (host === 'github') {
    annotation = `::error title=mnci ci ${phase}::${escapeCommandData(message)}`
  } else if (host === 'azure') {
    annotation = `##vso[task.logissue type=error;]${message}`
  }

  return {
    log:     `mnci ci ${phase}: failed (exit ${status}) in ${took}`,
    annotation,
    summary: `- ❌ **${phase}** failed (exit ${status}) after ${took}`,
  }
}
