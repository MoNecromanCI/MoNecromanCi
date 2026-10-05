import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCapture, runShell } from '../nx-workspace'
import { readNativeBuildConfig } from '../native-build-config'
import { GO_CGO_TAG, NATIVE_TARGETS } from '../workspace-overlay'
import { detectCiHost, groupEnd, groupStart, isMainPush } from './ci-environment.client'
import type { CiDependencies } from './phase.contract'

/**
 * Runs the native phase: lint, test, build and package the apps that need a C toolchain, on this OS.
 *
 * @remarks
 * A port of what each leg of the generated `native` job runs after its setup. An app that
 * links C code (`mnci add go-app --cgo`) cannot be cross-compiled from the single-agent job, so
 * the pipeline runs this on a runner of every OS it ships for; the verify step leaves those apps
 * out by the same tag, so each is built by exactly one of the two. The checkout and Node stay in the YAML.
 *
 * On a Linux leg of a CI run it first installs what a cgo build needs: a C compiler, `pkg-config` and the
 * packages of `mnci.native.linuxPackages` in `nx.json`. It only does so on a CI Linux agent (`RUNNER_OS` or
 * `AGENT_OS`), never on a developer's machine, where `sudo apt-get` is not its business.
 *
 * After a push to main, this OS's zip is attached to the GitHub Release the release phase just
 * created, by `tools/go-app-release.cjs assets --native`. A workspace with no releasable native
 * app has no such file and skips that; a pull request, a branch, an Azure run and a local run never attach.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The environment, the process runner and the logger; real ones by default.
 * @returns The exit status: 0 when everything passed, otherwise the first failing command's.
 * @throws Never - a command that fails is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export function runNative (workspaceRoot: string, dependencies: Partial<CiDependencies> = {}): number {
  const environment = dependencies.environment ?? process.env
  const processes = dependencies.processes ?? {
    run:     (command, arguments_) => runShell(command, arguments_, workspaceRoot),
    capture: (command, arguments_) => runCapture(command, arguments_, workspaceRoot),
  }
  const log = dependencies.log ?? ((message: string) => { console.log(message) })
  const host = detectCiHost(environment)

  /** Runs one command inside a log group, so its output collapses in the provider's UI. */
  const inGroup = (title: string, command: string, arguments_: string[]): number => {
    log(groupStart(host, title))
    const status = processes.run(command, arguments_)
    const closing = groupEnd(host)
    if (closing !== undefined) {
      log(closing)
    }

    return status
  }

  if (isLinuxAgent(environment)) {
    const prerequisites = installLinuxPrerequisites(workspaceRoot, inGroup)
    if (prerequisites !== 0) {
      return prerequisites
    }
  }
  const built = inGroup('Lint, test, build and package the native apps', 'npx', ['nx', 'run-many', '-t', NATIVE_TARGETS, `--projects=tag:${GO_CGO_TAG}`])
  if (built !== 0) {
    return built
  }
  // Only GitHub has a Release to attach to: an Azure leg publishes its zips as a pipeline artifact and stops.
  if (host !== 'github' || !isMainPush(environment) || !existsSync(join(workspaceRoot, 'tools', 'go-app-release.cjs'))) {
    return 0
  }

  return inGroup("Attach this OS's zip to the GitHub Release", 'node', ['tools/go-app-release.cjs', 'assets', '--native'])
}

/**
 * Whether this is a Linux CI agent, as GitHub Actions and Azure Pipelines each report it.
 *
 * @param environment - The process environment.
 * @returns True on a hosted or self-hosted Linux agent, false everywhere else, a laptop included.
 * @throws Never - pure environment reading.
 * @typeParam None - this function has no generic type parameters.
 */
function isLinuxAgent (environment: NodeJS.ProcessEnv): boolean {
  return environment.RUNNER_OS === 'Linux' || environment.AGENT_OS === 'Linux'
}

/**
 * Installs the compiler, `pkg-config` and the workspace's own `-dev` packages.
 *
 * @remarks
 * Package names come from `nx.json`, already validated by {@link readNativeBuildConfig}, and are
 * passed as separate arguments, so none can be read as an option or split by a shell.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param inGroup - Runs one command inside a log group.
 * @returns 0, or the status of the first command that failed.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function installLinuxPrerequisites (
  workspaceRoot: string,
  inGroup: (title: string, command: string, arguments_: string[]) => number,
): number {
  const { linuxPackages } = readNativeBuildConfig(workspaceRoot).config
  const updated = inGroup('Update the package index', 'sudo', ['apt-get', 'update'])
  if (updated !== 0) {
    return updated
  }

  return inGroup('Install the native prerequisites (Linux)', 'sudo', ['apt-get', 'install', '-y', 'gcc', 'pkg-config', ...linuxPackages])
}
