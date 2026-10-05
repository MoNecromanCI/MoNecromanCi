import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCapture, runShell } from '../nx-workspace'
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
 * out by the same tag, so each is built by exactly one of the two. The setup (checkout, Node, the
 * Linux `-dev` packages) stays in the YAML: it is the workspace's to extend.
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
