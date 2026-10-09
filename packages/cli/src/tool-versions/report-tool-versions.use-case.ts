import { runCaptureAsync } from '../nx-workspace'
import { logger } from '../terminal'
import {
  DOTNET_SDK_VERSION,
  FLUTTER_SDK_VERSION,
  GOLANGCI_LINT_VERSION,
  GO_VERSION,
  NODE_VERSION,
  NPM_VERSION,
} from '../workspace-overlay'
import { isNewerThanPin } from './compare-tool-versions.algorithm'
import { neutralDirectory, TOOL_QUERIES, type ToolQueryDependencies } from './latest-tool-versions.client'

/** How long one release source gets before it is treated as unreachable. */
const QUERY_TIMEOUT_MS = 8000

/** What mnci pins for each tool in {@link TOOL_QUERIES}, from the one constant that tool's version lives in. */
const PINS: Readonly<Record<string, string>> = {
  'golangci-lint': GOLANGCI_LINT_VERSION,
  'Node':          NODE_VERSION,
  'npm':           NPM_VERSION,
  'Go':            GO_VERSION,
  '.NET SDK':      DOTNET_SDK_VERSION,
  'Flutter SDK':   FLUTTER_SDK_VERSION,
}

/**
 * One pinned tool, and the newest release its own source reports.
 *
 * @remarks
 * `latest` is absent when the source could not be reached or the tool is not installed to ask.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ToolStatus {
  readonly name:    string
  readonly pinned:  string
  readonly latest?: string
  readonly newer:   boolean
}

/**
 * The real network and tools.
 *
 * @returns Dependencies that GET with a timeout and run commands from a neutral directory.
 * @throws Never - a failed request or command is an absent answer.
 * @typeParam None - this function has no generic type parameters.
 */
function defaultDependencies (): ToolQueryDependencies {
  return {
    fetchText: async url => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) })

        return response.ok ? await response.text() : undefined
      } catch {
        return
      }
    },
    capture: async (command, arguments_) => {
      const result = await runCaptureAsync(command, arguments_, neutralDirectory())

      return result.status === 0 ? result.stdout : undefined
    },
  }
}

/**
 * Asks each pinned tool's own source for its newest release.
 *
 * @remarks
 * All asked at once; a source that fails or answers nothing leaves that tool without a `latest` and never throws.
 *
 * @param dependencies - The network and tools; the real ones by default.
 * @returns One status per tool mnci pins, in a fixed order.
 * @throws Never - every query is isolated.
 * @typeParam None - this function has no generic type parameters.
 */
export async function checkToolVersions (dependencies: ToolQueryDependencies = defaultDependencies()): Promise<ToolStatus[]> {
  return await Promise.all(TOOL_QUERIES.map(async (query): Promise<ToolStatus> => {
    const pinned = PINS[query.name]
    let latest: string | undefined
    try {
      latest = await query.latest(dependencies)
    } catch {
      latest = undefined
    }

    return { name: query.name, pinned, latest, newer: latest !== undefined && isNewerThanPin(pinned, latest) }
  }))
}

/**
 * Prints which pinned tools have a newer release, informationally.
 *
 * @remarks
 * `mnci up` reports packages, but the tools mnci installs itself (a linter, Node, the Go, Flutter and .NET SDKs)
 * are not requirements of any manifest. Each is one pinned constant in mnci's source, so a newer release is not
 * something the workspace can act on: the remedy is an mnci release. Never fails the command, and says so when
 * none of the sources could be reached.
 *
 * @param dependencies - The network and tools; the real ones by default.
 * @returns Nothing.
 * @throws Never - an unreachable source is reported, not thrown.
 * @typeParam None - this function has no generic type parameters.
 */
export async function reportToolVersions (dependencies: ToolQueryDependencies = defaultDependencies()): Promise<void> {
  logger.step('Checking the tools mnci pins (informational)')
  const statuses = await checkToolVersions(dependencies)
  const answered = statuses.filter(status => status.latest !== undefined)
  if (answered.length === 0) {
    logger.info("⊘ SKIPPED tooling — none of the tools' release sources could be reached.")

    return
  }
  const newer = statuses.filter(status => status.newer)
  if (newer.length === 0) {
    logger.success('Every tool mnci pins is on its latest release.')

    return
  }
  for (const status of newer) {
    logger.info(`  ${status.name.padEnd(14)} pinned ${status.pinned.padEnd(8)} ›  ${status.latest}`)
  }
  logger.info("  These versions live in mnci's source, so the remedy is an mnci release, not a change to your workspace.")
}
