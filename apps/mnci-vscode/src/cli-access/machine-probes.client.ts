import { existsSync } from 'node:fs'
import spawn from 'cross-spawn'
import type { LocateProbes } from './locate-cli.use-case'

/** How long a probe may take before the command is treated as absent. */
const PROBE_TIMEOUT_MS = 5000

/**
 * The real answers to {@link LocateProbes}: the file system and a short-lived child process.
 *
 * @remarks
 * `cross-spawn` and not `child_process` directly, so a Windows `.cmd` shim starts without a shell.
 */
export const MACHINE_PROBES: LocateProbes = {
  fileExists:   path => existsSync(path),
  commandWorks: (command, arguments_) => {
    const result = spawn.sync(command, [...arguments_], { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS })

    return result.error === undefined && result.status === 0
  },
}
