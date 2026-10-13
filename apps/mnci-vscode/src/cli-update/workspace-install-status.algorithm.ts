import type { WorkspaceInstall, WorkspaceInstallStatus } from './workspace-install.contract'

/**
 * The numeric major, minor and patch of a version.
 *
 * @param version - A version such as `4.101.0` or `4.101.0-beta.1`.
 * @returns The three numbers, or `undefined` when it is not a numeric triple.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function triple (version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())

  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Says whether the workspace is on the newest `@mnci/cli`.
 *
 * @remarks
 * Installed, not declared, decides it: a `^4.100.0` range in `package.json` with 4.100.0 in `node_modules` is behind
 * 4.101.0 however the range reads, and a range with nothing installed is `missing`.
 *
 * @param install - What the workspace holds.
 * @param latest - The newest published version, or `null` when the registry did not answer.
 * @returns The status.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function workspaceInstallStatus (install: WorkspaceInstall, latest: string | null): WorkspaceInstallStatus {
  if (install.installed === undefined) {
    return 'missing'
  }
  if (latest === null) {
    return 'unknown'
  }
  const [have, want] = [triple(install.installed), triple(latest)]
  if (have === undefined || want === undefined) {
    return 'unknown'
  }
  const behind = have[0] === want[0] ? (have[1] === want[1] ? have[2] < want[2] : have[1] < want[1]) : have[0] < want[0]

  return behind ? 'outdated' : 'current'
}
