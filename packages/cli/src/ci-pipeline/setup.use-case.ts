import { existsSync, globSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runCapture, runShell } from '../nx-workspace'
import { detectCiHost, groupEnd, groupStart } from './ci-environment.client'
import { installFlutterSdk, publishFlutterSdk, resolveDartDependencies } from './flutter-sdk.use-case'
import { currentMachine, downloadGoModules, installGolangciLint, publishGoTools, type Machine } from './go-tools.use-case'
import type { CiDependencies, CiProcesses } from './phase.contract'

/** The interpreter's name: the python.org Windows installer registers only `python`, every POSIX system `python3`. */
function pythonCommand (machine: Machine): string {
  return machine.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Installs the fixed Python toolchain (ruff, pytest, build, twine) from `requirements-dev.txt`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @param machine - The machine, for the interpreter's name.
 * @returns 0 with no Python project (no `requirements-dev.txt`) or on success, otherwise pip's status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function installPythonToolchain (workspaceRoot: string, processes: CiProcesses, log: (message: string) => void, machine: Machine): number {
  if (!existsSync(join(workspaceRoot, 'requirements-dev.txt'))) {
    log('No Python projects - skipping.')

    return 0
  }

  return processes.run(pythonCommand(machine), ['-m', 'pip', 'install', '-r', 'requirements-dev.txt'])
}

/**
 * Installs every Python project into one shared environment, so imports between them resolve.
 *
 * @remarks
 * Pip has no workspace protocol, so this is built by hand: each project with a `pyproject.toml`
 * (`apps/*`, `python-packages/*`, `libs/*`: apps, publishable libraries and internal libraries alike)
 * is installed editable, and each Azure Function app (a `requirements.txt` and no `pyproject.toml`)
 * from its requirements, all in **one** `pip install` so the resolver sees every requirement together.
 * It is broader than the `test` executor's own per-project install on purpose: an internal library
 * is normally woven into a consumer only at build time, so without this a project that imports one
 * could not resolve the import when it is tested, only in the built wheel. It does not change what a
 * published wheel contains.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @param machine - The machine, for the interpreter's name.
 * @returns 0 with no Python project or on success, otherwise pip's status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function installPythonProjects (workspaceRoot: string, processes: CiProcesses, log: (message: string) => void, machine: Machine): number {
  const editable = ['apps/*/pyproject.toml', 'python-packages/*/pyproject.toml', 'libs/*/pyproject.toml']
    .flatMap(pattern => globSync(pattern, { cwd: workspaceRoot }))
    .map(path => dirname(path))
  const requirements = globSync('apps/*/requirements.txt', { cwd: workspaceRoot })
  if (editable.length === 0 && requirements.length === 0) {
    log('No Python projects - skipping.')

    return 0
  }

  return processes.run(pythonCommand(machine), [
    '-m', 'pip', 'install', '--quiet',
    ...editable.flatMap(directory => ['-e', directory]),
    ...requirements.flatMap(file => ['-r', file]),
  ])
}

/**
 * Runs the setup phase: the toolchains the workspace's languages need, installed and on `PATH`.
 *
 * @remarks
 * A port of the setup steps of the generated pipelines, in their order, each skipping cleanly when
 * the workspace has no project in that language: the Python toolchain and projects, the Go modules
 * and `golangci-lint` and its place on `PATH`, the Flutter SDK, its place on `PATH` and the Dart
 * dependencies. It stops at the first failure, as a failed step stopped the pipeline. Node itself and
 * `npm ci` are not here: Node must exist before `npx mnci` can run, so they stay in the pipeline.
 * The `npm audit` and `pip-audit` gates are the `audit` phase.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The environment, process runner, logger and downloader; real ones by default.
 * @param machine - The machine, which picks the tool releases and where the Flutter SDK goes.
 * @returns 0 when every step passed or was skipped, otherwise the first failing step's status.
 * @throws Never - a command that fails is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runSetup (
  workspaceRoot: string,
  dependencies: Partial<CiDependencies> = {},
  machine: Machine = currentMachine(),
): Promise<number> {
  const environment = dependencies.environment ?? process.env
  const processes = dependencies.processes ?? {
    run:     (command, arguments_) => runShell(command, arguments_, workspaceRoot),
    capture: (command, arguments_) => runCapture(command, arguments_, workspaceRoot),
  }
  const log = dependencies.log ?? ((message: string) => { console.log(message) })
  const fetchBytes = dependencies.fetchBytes ?? (async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`)
    }

    return Buffer.from(await response.arrayBuffer())
  })
  const host = detectCiHost(environment)

  /** Runs one step inside a log group, so its output collapses in the provider's UI. */
  const step = async (title: string, work: () => number | Promise<number>): Promise<number> => {
    log(groupStart(host, title))
    const status = await work()
    const closing = groupEnd(host)
    if (closing !== undefined) {
      log(closing)
    }

    return status
  }
  const steps: Array<[string, () => number | Promise<number>]> = [
    ['Install Python dependencies (ruff, pytest, build, twine)', () => installPythonToolchain(workspaceRoot, processes, log, machine)],
    ['Install Python project dependencies (editable, workspace-wide)', () => installPythonProjects(workspaceRoot, processes, log, machine)],
    ['Download Go module dependencies', () => downloadGoModules(workspaceRoot, processes, log)],
    ['Install golangci-lint', () => installGolangciLint(workspaceRoot, { processes, log, fetchBytes }, machine)],
    ['Add Go tool bin to PATH', () => {
      publishGoTools(workspaceRoot, host, environment, processes, log)

      return 0
    }],
    ['Install the Flutter SDK', () => installFlutterSdk(workspaceRoot, processes, log, machine)],
    ['Add the Flutter SDK to PATH', () => {
      publishFlutterSdk(workspaceRoot, host, environment, log, machine)

      return 0
    }],
    ['Resolve Dart dependencies (one pub get for the whole workspace)', () => resolveDartDependencies(workspaceRoot, processes, log)],
  ]
  for (const [title, work] of steps) {
    const status = await step(title, work)
    if (status !== 0) {
      log(`Setup stopped at: ${title}`)

      return status
    }
  }

  return 0
}
