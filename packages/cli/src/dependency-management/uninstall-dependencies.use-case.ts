import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runShell } from '../nx-workspace'
import { writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import { completeLockfile } from '../lockfile-completion'
import { type ProjectLocation, locateProjects } from './manifest.repository'
import { findPackageImports } from './find-package-imports.use-case'
import { removeBundlerGems } from './bundler-dependencies.use-case'
import { removeComposerPackages } from './composer-dependencies.use-case'
import { removeGradleDependencies } from './gradle-dependencies.use-case'
import { removeMavenDependencies } from './maven-dependencies.use-case'
import { removePipDependency } from './remove-pip-dependency.algorithm'
import { resolveTarget } from './resolve-target-project.use-case'

/**
 * Options for `mnci uninstall` (alias `mnci un`).
 *
 * @remarks
 * The same addressing as `mnci install`: `-w/--workspace` names the project and repeats.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export interface UninstallOptions {
  /** Target project(s): the repeatable `-w/--workspace` flag. */
  workspace?: string[]
}

/**
 * Removes dependencies from one project with its own toolchain.
 *
 * @remarks
 * The counterpart of `mnci install -w <project> <package>`, with the same refusals: a package with no target project is
 * refused rather than taken from the root, and nothing is removed without a package named. Dispatch is by the target's
 * ecosystem: `npm uninstall -w`, `go get <pkg>@none`, `dotnet remove package`, `flutter pub remove`, and for pip an edit
 * of `pyproject.toml` (pip has no "remove from the manifest" verb, as it has none to add).
 *
 * After an npm removal the project's source is searched for imports of what was removed and each file is named in a
 * warning: the declaration is gone, so those imports will no longer resolve. It never fails on them.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param packages - The packages to remove, by name.
 * @param options - The target project(s).
 * @returns Nothing; sets `process.exitCode` to 1 on an unresolved target or a misuse.
 * @throws Never - a failed native command is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function runUninstall (
  workspaceRoot: string,
  packages: string[],
  options: UninstallOptions = {},
): void {
  if (packages.length === 0) {
    logger.error("Name the package to remove — 'mnci uninstall -w <project> <package>'")
    process.exitCode = 1

    return
  }
  const targets = options.workspace ?? []
  if (targets.length === 0) {
    logger.error(
      "Removing a package needs a target project — 'mnci uninstall -w <project> <package>'. A dependency belongs to the project that imports it, so there is no workspace-wide removal",
    )
    process.exitCode = 1

    return
  }

  const locations = locateProjects(workspaceRoot)
  for (const target of targets) {
    const location = resolveTarget(locations, target)
    if (location === undefined) {
      logger.error(
        `No project '${target}' — looked for a manifest under apps/, libs/, packages/ (and python-packages/). Name it by directory (apps/${target}) or by its basename`,
      )
      process.exitCode = 1

      continue
    }
    uninstallFrom(workspaceRoot, location, packages, locations)
  }
  if (locations.some(location => location.ecosystem === 'npm')) {
    completeLockfile(workspaceRoot)
  }
}

/**
 * Removes packages from one project, using its own toolchain.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The resolved target project.
 * @param packages - The packages to remove.
 * @param locations - Every project of the workspace.
 * @returns Nothing.
 * @throws Never - a failed native command is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function uninstallFrom (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  locations: readonly ProjectLocation[],
): void {
  const projectDir = join(workspaceRoot, location.dir)

  switch (location.ecosystem) {
    case 'npm': {
      shell(workspaceRoot, 'npm', ['uninstall', ...packages, '-w', location.dir], location)
      for (const name of packages) {
        const importers = findPackageImports(projectDir, name)
        if (importers.length > 0) {
          logger.warn(`${name} is removed from ${location.dir} but still imported by ${importers.join(', ')}`)
        }
      }

      return
    }
    case 'go': {
      for (const name of packages) {
        // `@none` is Go's own way to drop a requirement.
        shell(projectDir, 'go', ['get', `${name}@none`], location)
      }
      runShell('go', ['work', 'sync'], workspaceRoot)

      return
    }
    case 'nuget': {
      for (const name of packages) {
        shell(workspaceRoot, 'dotnet', ['remove', location.manifestPath, 'package', name], location)
      }

      return
    }
    case 'cmake': {
      logger.warn(`${location.dir} is a C++ project with no package manager wired yet (#473), so it has no dependency to remove here.`)
      process.exitCode = 1

      return
    }
    case 'maven': {
      removeMavenDependencies(workspaceRoot, location, packages)

      return
    }
    case 'gradle': {
      removeGradleDependencies(workspaceRoot, location, packages, locations)

      return
    }
    case 'composer': {
      removeComposerPackages(workspaceRoot, location, packages, locations)

      return
    }
    case 'bundler': {
      removeBundlerGems(workspaceRoot, location, packages, locations)

      return
    }
    case 'cargo': {
      shell(workspaceRoot, 'cargo', ['remove', ...packages, '--manifest-path', location.manifestPath], location)

      return
    }
    case 'pub': {
      shell(projectDir, 'flutter', ['pub', 'remove', ...packages], location)

      return
    }
    case 'pip': {
      for (const name of packages) {
        removePythonDependency(location.manifestPath, name)
      }
      logger.info('The package stays installed in the shared Python environment until it is recreated; `pip uninstall` removes it now')

      return
    }
  }
}

/**
 * Removes one dependency from a project's `pyproject.toml`.
 *
 * @param manifestPath - Absolute path to the project's `pyproject.toml`.
 * @param name - The package to remove.
 * @returns Nothing.
 * @throws Never - an unreadable manifest is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function removePythonDependency (manifestPath: string, name: string): void {
  let content: string
  try {
    content = readFileSync(manifestPath, 'utf8')
  } catch {
    logger.warn(`Could not read ${manifestPath} — skipped ${name}`)

    return
  }
  const updated = removePipDependency(content, name)
  if (updated === content) {
    logger.info(`${name} is not declared in ${manifestPath} — left as is`)

    return
  }
  writeFileEnsured(manifestPath, updated)
  logger.step(`Removed ${name} from ${manifestPath}`)
}

/**
 * Runs a native dependency command, reporting a non-zero exit as a warning.
 *
 * @param cwd - The directory to run in.
 * @param command - The executable.
 * @param arguments_ - Its arguments.
 * @param location - The project the command acts on, for the message.
 * @returns Nothing.
 * @throws Never - a non-zero exit is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function shell (
  cwd: string,
  command: string,
  arguments_: readonly string[],
  location: ProjectLocation,
): void {
  logger.step(`${location.dir}: ${command} ${arguments_.join(' ')}`)
  if (runShell(command, [...arguments_], cwd) !== 0) {
    logger.warn(`${command} ${arguments_.join(' ')} failed in ${location.dir}`)
  }
}
