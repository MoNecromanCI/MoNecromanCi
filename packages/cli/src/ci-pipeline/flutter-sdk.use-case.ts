import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FLUTTER_SDK_VERSION } from '../workspace-overlay'
import { addToPath, type CiHost } from './ci-environment.client'
import type { Machine } from './go-tools.use-case'
import type { CiProcesses } from './phase.contract'

/**
 * Where mnci installs the Flutter SDK when the runner has none.
 *
 * @remarks
 * In the user's home, never inside the workspace: the SDK ships its own nested `pubspec.yaml` files,
 * which would pollute pub resolution and the Nx project graph. The version is in the name, so a
 * pin bump installs beside the old one instead of reusing it.
 *
 * @param machine - The machine, for its home directory.
 * @returns The absolute directory.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function flutterSdkDirectory (machine: Machine): string {
  return join(machine.home, `.mnci-flutter-${FLUTTER_SDK_VERSION}`)
}

/**
 * Installs the pinned Flutter SDK when the workspace has Flutter projects and the runner has none.
 *
 * @remarks
 * Skips with no `pubspec.yaml` at the root, when `flutter` already answers on `PATH` (a developer's
 * machine, or a runner image that ships one), and when an earlier run left the pinned SDK in place
 * (the directory is cached between runs). Otherwise it shallow-clones the pinned tag.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @param machine - The machine, for where to install.
 * @returns 0 when the SDK is available afterwards or nothing was needed, otherwise the clone's status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
export function installFlutterSdk (workspaceRoot: string, processes: CiProcesses, log: (message: string) => void, machine: Machine): number {
  if (!existsSync(join(workspaceRoot, 'pubspec.yaml'))) {
    log('No Flutter projects - skipping.')

    return 0
  }
  if (processes.capture('flutter', ['--version']).status === 0) {
    log('Flutter SDK already on PATH - skipping.')

    return 0
  }
  const sdk = flutterSdkDirectory(machine)
  if (existsSync(sdk)) {
    log(`Flutter SDK already installed at ${sdk} - skipping.`)

    return 0
  }

  return processes.run('git', ['clone', '--depth', '1', '--branch', FLUTTER_SDK_VERSION, 'https://github.com/flutter/flutter.git', sdk])
}

/**
 * Puts the SDK mnci installed on `PATH` for the steps that follow.
 *
 * @remarks
 * Only an SDK mnci cloned needs this: one already on `PATH` is found by the steps that follow.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param host - Where the phase is running.
 * @param environment - The process environment.
 * @param log - The logger.
 * @param machine - The machine, for where the SDK is.
 * @returns Nothing; it skips with no Flutter project, and when mnci installed nothing (Flutter was already on `PATH`).
 * @throws Error when the CI's PATH file cannot be appended to.
 * @typeParam None - this function has no generic type parameters.
 */
export function publishFlutterSdk (
  workspaceRoot: string,
  host: CiHost,
  environment: NodeJS.ProcessEnv,
  log: (message: string) => void,
  machine: Machine,
): void {
  if (!existsSync(join(workspaceRoot, 'pubspec.yaml'))) {
    log('No Flutter projects - skipping.')

    return
  }
  const sdk = flutterSdkDirectory(machine)
  if (!existsSync(sdk)) {
    log('Flutter SDK was not installed by mnci (already on PATH) - skipping.')

    return
  }
  addToPath(host, environment, join(sdk, 'bin'), log)
}

/**
 * Resolves the Dart dependencies of every Flutter project with one `flutter pub get`.
 *
 * @remarks
 * One command at the workspace root, because the projects are one pub workspace with one lockfile.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0 with no Flutter project or on success, otherwise the command's status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
export function resolveDartDependencies (workspaceRoot: string, processes: CiProcesses, log: (message: string) => void): number {
  if (!existsSync(join(workspaceRoot, 'pubspec.yaml'))) {
    log('No Flutter projects - skipping.')

    return 0
  }

  return processes.run('flutter', ['pub', 'get'])
}
