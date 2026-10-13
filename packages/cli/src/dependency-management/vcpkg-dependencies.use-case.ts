import { existsSync, globSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileEnsured } from '../file-system'
import { runShell } from '../nx-workspace'
import { logger } from '../terminal'
import { cppIdentifier } from './cmake-sibling.algorithm'
import type { ProjectLocation } from './manifest.repository'
import {
  addVcpkgLink,
  addVcpkgPort,
  isVcpkgPortName,
  parseVcpkgUsage,
  removeVcpkgLink,
  removeVcpkgPort,
  withVcpkgToolchainHook,
} from './vcpkg-manifest.algorithm'

/**
 * Whether `VCPKG_ROOT` names a vcpkg checkout CMake can use.
 *
 * @remarks
 * The project's CMake hook reads `VCPKG_ROOT` and nothing else, so this is the one thing that has to be right: a `vcpkg` on
 * `PATH` with the variable unset would install into a tree CMake never looks at.
 *
 * @returns `true` when the variable is set and holds vcpkg's CMake toolchain file.
 * @throws Never - a missing folder is `false`.
 * @typeParam None - this function has no generic type parameters.
 */
function vcpkgRootIsSet (): boolean {
  const root = process.env.VCPKG_ROOT

  return root !== undefined && root !== '' && existsSync(join(root, 'scripts', 'buildsystems', 'vcpkg.cmake'))
}

/**
 * Adds vcpkg ports to a C++ project: its `vcpkg.json`, its `CMakeLists.txt`, and an install that proves they resolve.
 *
 * @remarks
 * The port goes into the project's own manifest (manifest mode: dependencies are per project, never the root). CMake then
 * configures the project into its build directory, which makes vcpkg's toolchain install the manifest with the triplet the
 * build will use, and the CMake lines come from the port's own `usage` file, so the target name is the library's, not a
 * guess. A failed configure puts the manifest back and sets the exit code. Nothing is changed when `VCPKG_ROOT` is not
 * set: the message says how to get vcpkg.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The C++ project that gains the ports.
 * @param ports - The ports to add, by name.
 * @returns Nothing.
 * @throws Error when a project file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addVcpkgPorts (workspaceRoot: string, location: ProjectLocation, ports: readonly string[]): void {
  if (!vcpkgRootIsSet()) {
    logger.warn('VCPKG_ROOT is not set to a vcpkg checkout, so nothing was changed. Install vcpkg once: git clone https://github.com/microsoft/vcpkg, run its bootstrap script, and set VCPKG_ROOT to the folder.')
    process.exitCode = 1

    return
  }
  const projectDir = join(workspaceRoot, location.dir)
  const manifestPath = join(projectDir, 'vcpkg.json')
  // The build directory the project's own `build` target uses, where the toolchain puts `vcpkg_installed`.
  const buildDirectory = join(workspaceRoot, 'dist', 'cmake', location.name)
  const installRoot = join(buildDirectory, 'vcpkg_installed')

  for (const port of ports) {
    if (!isVcpkgPortName(port)) {
      logger.warn(`${port} is not a vcpkg port name (lowercase letters, digits and hyphens). A version, a feature or a triplet is not given here: pin one in vcpkg.json by hand.`)
      process.exitCode = 1
      continue
    }
    const before = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined
    const next = addVcpkgPort(before, location.name, port)
    if (next === undefined) {
      logger.warn(`${location.dir}/vcpkg.json is not a JSON object, so ${port} was not added.`)
      process.exitCode = 1
      continue
    }
    writeFileEnsured(manifestPath, next)
    // Configured by CMake itself, so the triplet is the one the build will use (vcpkg's own default differs on MinGW).
    // The port is not linked yet, so this configures cleanly and installs the manifest as a side effect.
    const hooked = withVcpkgToolchainHook(readFileSync(location.manifestPath, 'utf8'))
    writeFileEnsured(location.manifestPath, hooked)
    // A build tree configured before the toolchain was named ignores it for good, so vcpkg would never run: start it afresh.
    rmSync(join(buildDirectory, 'CMakeCache.txt'), { force: true })
    rmSync(join(buildDirectory, 'CMakeFiles'), { recursive: true, force: true })
    const status = runShell('cmake', ['-S', projectDir, '-B', buildDirectory, '-DCMAKE_BUILD_TYPE=Release'], workspaceRoot)
    if (status !== 0) {
      if (before === undefined) {
        rmSync(manifestPath, { force: true })
      } else {
        writeFileEnsured(manifestPath, before)
      }
      logger.warn(`CMake could not configure ${location.dir} with ${port}, so ${location.dir}/vcpkg.json is as it was. Is the name right? (vcpkg search ${port})`)
      process.exitCode = 1
      continue
    }
    const usagePath = globSync(`*/share/${port}/usage`, { cwd: installRoot }).at(0)
    const lines = usagePath === undefined ? undefined : parseVcpkgUsage(readFileSync(join(installRoot, usagePath), 'utf8'), cppIdentifier(location.name))
    if (lines === undefined) {
      logger.warn(`${port} is in ${location.dir}/vcpkg.json and installed, but it names no CMake target to link. Read share/${port}/usage under ${installRoot} and add what it says to ${location.dir}/CMakeLists.txt.`)
      continue
    }
    writeFileEnsured(location.manifestPath, addVcpkgLink(hooked, port, lines))
    logger.step(`${location.dir}: added ${port} (vcpkg.json and ${lines.filter(line => line.startsWith('target_link_libraries')).join(' ')})`)
  }
}

/**
 * Removes vcpkg ports from a C++ project: the manifest entry and the CMake lines mnci added for it.
 *
 * @remarks
 * Text edits only, so it needs no vcpkg. A port the project does not declare is reported, and a port whose CMake lines
 * were written by hand is left in `CMakeLists.txt` with a message, since only the lines between mnci's markers are its own.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The C++ project.
 * @param ports - The ports to remove.
 * @returns Nothing.
 * @throws Error when a project file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeVcpkgPorts (workspaceRoot: string, location: ProjectLocation, ports: readonly string[]): void {
  const manifestPath = join(workspaceRoot, location.dir, 'vcpkg.json')
  for (const port of ports) {
    const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined
    const result = manifest === undefined ? undefined : removeVcpkgPort(manifest, port)
    if (result === undefined || !result.removed) {
      logger.warn(`${port} is not a vcpkg dependency of ${location.dir}.`)
      process.exitCode = 1
      continue
    }
    writeFileEnsured(manifestPath, result.text)
    const cmake = readFileSync(location.manifestPath, 'utf8')
    const without = removeVcpkgLink(cmake, port)
    if (without === cmake) {
      logger.warn(`${port} is removed from vcpkg.json, but ${location.dir}/CMakeLists.txt has no block mnci wrote for it: remove its find_package and target_link_libraries by hand.`)
    } else {
      writeFileEnsured(location.manifestPath, without)
    }
    logger.step(`${location.dir}: removed ${port}`)
  }
}
