import type { CaptureResult } from '../nx-workspace'

/**
 * The processes a phase starts.
 *
 * @remarks
 * Injectable so every branch can be tested without a repository: the default runner shells
 * out, and a test hands in a recorder. Shared by every phase, so a port's parity test and
 * its unit test reach it the same way.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CiProcesses {
  /** Runs a command with its output going straight through, and returns its exit status. */
  run:     (command: string, arguments_: string[]) => number
  /** Runs a command and returns what it printed. */
  capture: (command: string, arguments_: string[]) => CaptureResult
}

/**
 * What a phase reads from outside.
 *
 * @remarks
 * All of it defaults to the real thing; a test overrides the parts it needs to control. One
 * bag for every phase: a phase that does not read the environment (for example `pack`) still
 * takes it, because {@link CiProcesses} log groups are keyed on the detected host.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CiDependencies {
  environment: NodeJS.ProcessEnv
  processes:   CiProcesses
  log:         (message: string) => void
}
