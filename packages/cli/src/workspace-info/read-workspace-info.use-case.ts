import { join } from 'node:path'
import { fetchLatestVersion, isNewerVersion } from '../cli-version'
import { fileExists } from '../file-system'
import { logger, printJson } from '../terminal'
import { readMnciConfig } from '../workspace-overlay'
import type { WorkspaceInfo } from './project-summary.contract'

/**
 * Flags of `mnci info`.
 *
 * @remarks
 * `mnci info` has only the one flag.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface InfoOptions {
  /** Print the report as one JSON document, for an editor or a script. */
  json?: boolean
}

/**
 * Reports the installed CLI version, the newest published one, and the workspace settings.
 *
 * @remarks
 * The workspace half is `null` outside a workspace, so an editor can show the version panel
 * before any folder is a workspace. The registry call is bounded by a short timeout and
 * leaves `latest` as `null` when it fails, never failing the command.
 *
 * @param workspaceRoot - Absolute path of the directory the command ran in.
 * @param cliVersion - The running CLI version.
 * @returns The report.
 * @throws Error when `nx.json` exists but is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function readWorkspaceInfo (workspaceRoot: string, cliVersion: string): WorkspaceInfo {
  const latest = fetchLatestVersion() ?? null
  const isWorkspace = fileExists(join(workspaceRoot, 'nx.json'))

  return {
    cli: {
      version:         cliVersion,
      latest,
      updateAvailable: latest !== null && isNewerVersion(latest, cliVersion),
    },
    workspace: isWorkspace ? { root: workspaceRoot, config: { ...readMnciConfig(workspaceRoot) } } : null,
  }
}

/**
 * Prints the CLI and workspace report.
 *
 * @remarks
 * `--json` is what an editor's version panel is built from.
 *
 * @param workspaceRoot - Absolute path of the directory the command ran in.
 * @param cliVersion - The running CLI version.
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Error when `nx.json` exists but is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function runInfo (workspaceRoot: string, cliVersion: string, options: InfoOptions): void {
  const info = readWorkspaceInfo(workspaceRoot, cliVersion)
  if (options.json === true) {
    printJson(info)

    return
  }
  logger.info(`mnci ${info.cli.version}${info.cli.updateAvailable ? ` (${info.cli.latest} is available)` : ''}`)
  logger.info(info.workspace ? `workspace: ${info.workspace.root}` : 'not inside a workspace')
}
