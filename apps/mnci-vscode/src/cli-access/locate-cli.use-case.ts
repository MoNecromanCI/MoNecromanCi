import { join } from 'node:path'
import type { CliLocation } from './cli-location.contract'
import { isCliVersionSupported } from './cli-version.algorithm'

/**
 * What locating the CLI needs to ask the machine, so a test can answer instead.
 *
 * @remarks
 * `commandOutput` runs the command with the arguments and returns what it printed, or `undefined`
 * when it could not be started or exited non-zero.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface LocateProbes {
  fileExists:    (path: string) => boolean
  commandOutput: (command: string, arguments_: readonly string[]) => string | undefined
}

/**
 * What decides which CLI to use.
 *
 * @remarks
 * Both fields are optional: with no setting and no workspace folder open, the search starts
 * at a global install.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface LocateOptions {
  /** The `mnci.cliPath` setting; empty or absent means "find it". */
  readonly configured?:    string
  /** The first workspace folder's path. */
  readonly workspaceRoot?: string
  readonly platform:       NodeJS.Platform
}

/**
 * Chooses which mnci CLI the extension runs.
 *
 * @remarks
 * In order: the `mnci.cliPath` setting, the workspace's own install (`node_modules/.bin`,
 * which is the version the workspace was built with), a global install, and last `npx`, which
 * fetches the newest on demand and so needs the network. The first that works wins.
 *
 * An install older than the first release with the JSON commands is skipped, not used: every view
 * would fail with `unknown option '--json'`. The setting is the user's own choice and is kept as it is.
 *
 * @param options - The setting, the workspace folder and the platform.
 * @param probes - How to check the machine.
 * @returns The location to use.
 * @throws Never - `npx` is the fallback and is not probed.
 * @typeParam None - this function has no generic type parameters.
 */
export function locateCli (options: LocateOptions, probes: LocateProbes): CliLocation {
  const configured = options.configured?.trim()
  if (configured) {
    return { command: configured, prefix: [], source: 'setting' }
  }
  if (options.workspaceRoot) {
    const local = join(options.workspaceRoot, 'node_modules', '.bin', options.platform === 'win32' ? 'mnci.cmd' : 'mnci')
    if (probes.fileExists(local) && isSupported(probes, local)) {
      return { command: local, prefix: [], source: 'workspace' }
    }
  }
  if (isSupported(probes, 'mnci')) {
    return { command: 'mnci', prefix: [], source: 'path' }
  }

  return { command: 'npx', prefix: ['--yes', '@mnci/cli'], source: 'npx' }
}

/**
 * Whether the CLI at a path starts and is new enough for the extension.
 *
 * @param probes - How to check the machine.
 * @param command - The executable.
 * @returns True when `--version` printed a version at or above the minimum.
 * @throws Never - a command that fails is not supported.
 * @typeParam None - this function has no generic type parameters.
 */
function isSupported (probes: LocateProbes, command: string): boolean {
  const output = probes.commandOutput(command, ['--version'])

  return output !== undefined && isCliVersionSupported(output)
}
