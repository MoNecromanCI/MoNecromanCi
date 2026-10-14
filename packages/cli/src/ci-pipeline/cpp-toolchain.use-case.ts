import { existsSync } from 'node:fs'
import { VCPKG_VERSION } from '../workspace-overlay'
import { hasProjectManifest } from './find-project-manifest.use-case'
import type { CiProcesses } from './phase.contract'

/** The compilers a CMake build can pick up from `PATH`, in the order they are tried. */
const COMPILERS = ['c++', 'g++', 'clang++']

/** The CMake version the generated `CMakeLists.txt` asks for (`cmake_minimum_required`). */
const CMAKE_MINIMUM = [3, 20]

/**
 * Whether a `cmake --version` line is at least {@link CMAKE_MINIMUM}.
 *
 * @param text - Output such as `cmake version 4.4.0`.
 * @returns False when the version is known and older; true when it is new enough or cannot be read.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function isCmakeNewEnough (text: string): boolean {
  const match = /(\d+)\.(\d+)/.exec(text)
  if (match === null) {
    return true
  }
  const [major, minor] = [Number(match[1]), Number(match[2])]

  return major > CMAKE_MINIMUM[0] || (major === CMAKE_MINIMUM[0] && minor >= CMAKE_MINIMUM[1])
}

/**
 * Checks the C++ toolchain of a workspace that has CMake projects.
 *
 * @remarks
 * Nothing is installed: the hosted images carry a compiler and CMake, and a missing tool is named here because the build
 * would otherwise fail later with a message about CMake rather than the runner. `cppcheck` is what `lint` runs. vcpkg is
 * checked only when a project has a `vcpkg.json`, and by `VCPKG_ROOT` alone (the one thing the project's CMake hook
 * reads); the devcontainer clones it at {@link VCPKG_VERSION} and sets that variable.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @param environment - The process environment, for `VCPKG_ROOT`.
 * @returns 0: this step informs, it does not fail a build the toolchain itself will judge.
 * @throws Never - a missing tool is a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function checkCppToolchain (
  workspaceRoot: string,
  processes: CiProcesses,
  log: (message: string) => void,
  environment: Readonly<Record<string, string | undefined>>,
): number {
  if (!hasProjectManifest(workspaceRoot, 'CMakeLists.txt')) {
    log('No C++ projects - skipping.')

    return 0
  }
  const cmake = processes.capture('cmake', ['--version'])
  if (cmake.status !== 0) {
    log('Warning: CMake was not found on PATH; the C++ projects need CMake 3.20 or newer.')
  } else if (isCmakeNewEnough(cmake.stdout)) {
    log(`${cmake.stdout.split('\n', 1)[0]?.trim() ?? 'CMake'} found.`)
  } else {
    log(`Warning: this runner's ${cmake.stdout.split('\n', 1)[0]?.trim() ?? 'CMake'} is older than 3.20, which the projects ask for.`)
  }
  const compiler = COMPILERS.find(name => processes.capture(name, ['--version']).status === 0)
  if (compiler === undefined && environment.OS !== 'Windows_NT') {
    log(`Warning: no C++ compiler (${COMPILERS.join(', ')}) was found on PATH.`)
  } else if (compiler !== undefined) {
    log(`C++ compiler ${compiler} found.`)
  }
  if (processes.capture('cppcheck', ['--version']).status !== 0) {
    log('Warning: cppcheck was not found on PATH; the C++ projects\' lint target runs it.')
  }
  if (hasProjectManifest(workspaceRoot, 'vcpkg.json')) {
    const root = environment.VCPKG_ROOT
    if (root === undefined || root === '' || !existsSync(root)) {
      log(`Warning: VCPKG_ROOT does not name a vcpkg checkout; clone https://github.com/microsoft/vcpkg at ${VCPKG_VERSION}, bootstrap it and set VCPKG_ROOT.`)
    } else {
      log(`vcpkg found at ${root}.`)
    }
  }

  return 0
}
