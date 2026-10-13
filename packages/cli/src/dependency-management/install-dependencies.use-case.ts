import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { runShell } from '../nx-workspace'
import { writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import { completeLockfile } from '../lockfile-completion'
import {
  type Ecosystem,
  type ProjectLocation,
  addPipDependency,
  hasEcosystem,
  locateProjects,
} from './manifest.repository'
import { addCmakeSibling } from './cmake-sibling.algorithm'
import { addBundlerGems } from './bundler-dependencies.use-case'
import { addComposerPackages } from './composer-dependencies.use-case'
import { addGradleDependencies } from './gradle-dependencies.use-case'
import { addMavenDependencies } from './maven-dependencies.use-case'
import { addVcpkgPorts } from './vcpkg-dependencies.use-case'
import { resolveTarget } from './resolve-target-project.use-case'

/**
 * Options for `mnci install` (alias `mnci i`).
 *
 * @remarks
 * Modelled on `npm install -w`: `-w/--workspace` names the target project and
 * repeats, and with no target a bare `mnci install` installs the whole
 * workspace. `--save-dev` maps to each toolchain's dev-dependency notion where
 * one exists.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export interface InstallOptions {
  /** Target project(s): the repeatable `-w/--workspace` flag. Empty means the whole workspace. */
  workspace?: string[]
  /** Add as a development dependency, where the ecosystem distinguishes one. */
  saveDev?:   boolean
}

/**
 * The whole-workspace install command for each ecosystem, for a bare `mnci install`.
 *
 * @remarks
 * These restore an already-declared set, they do not add anything. Go is
 * `go work sync`, not the single-module `go mod tidy` the old codebase used:
 * under multi-module (MoNecromanCI/MoNecromanCi#289) there is no root module to tidy, and
 * `go work sync` is what propagates the workspace's module set to every member.
 */
const WHOLE_WORKSPACE_INSTALL: ReadonlyArray<readonly [Ecosystem, string, readonly string[]]> = [
  ['npm', 'npm', ['install']],
  ['pip', 'npm', ['run', 'python:install']],
  ['pub', 'flutter', ['pub', 'get']],
  ['nuget', 'npx', ['nx', 'run-many', '-t', 'restore']],
  ['cargo', 'cargo', ['fetch']],
  ['maven', 'mvn', ['-B', '-ntp', 'compile']],
  ['gradle', 'gradle', ['--console=plain', '-q', 'assemble']],
  // The shared dev tools at the root, then each project's own dependencies through its build target.
  ['composer', 'composer', ['install', '--no-interaction']],
  ['composer', 'npx', ['nx', 'run-many', '-t', 'build', '--projects=tag:type:php-*']],
  ['bundler', 'bundle', ['install']],
  ['bundler', 'npx', ['nx', 'run-many', '-t', 'build', '--projects=tag:type:ruby-*']],
  ['go', 'go', ['work', 'sync']],
]

/**
 * Adds dependencies to one project with its own toolchain, or installs everything.
 *
 * @remarks
 * The per-project-dependency philosophy needs one command that reaches any
 * project whatever its language, instead of the developer remembering
 * `npm install -w`, `pip`, `dotnet add`, `flutter pub add` and `go get` and
 * where each manifest lives. Dispatch is by the target's ecosystem, resolved
 * from its manifest's location ({@link locateProjects}).
 *
 * Three shapes:
 *
 * - **`mnci i`** (no target, no packages) — install/restore the whole workspace.
 * - **`mnci i -w <project>`** (target, no packages) — install just that project.
 * - **`mnci i -w <project> <pkg>…`** — add each package to that project.
 *
 * A package with no target is refused rather than silently added to the root,
 * which the per-project philosophy forbids.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param packages - The packages to add, verbatim (a bare name or a pinned spec); empty to install only.
 * @param options - The target project(s) and the dev-dependency flag.
 * @returns Nothing; sets `process.exitCode` to 1 on an unresolved target or a misuse.
 * @throws Never - a failed native install is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function runInstall (
  workspaceRoot: string,
  packages: string[],
  options: InstallOptions = {},
): void {
  const targets = options.workspace ?? []

  if (targets.length === 0) {
    if (packages.length > 0) {
      logger.error(
        "Adding a package needs a target project — 'mnci install -w <project> <package>'. A bare 'mnci install' (no package) installs the whole workspace",
      )
      process.exitCode = 1

      return
    }
    installEverything(workspaceRoot)

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
    installInto(workspaceRoot, location, packages, Boolean(options.saveDev), locations)
  }
  if (locations.some(location => location.ecosystem === 'npm')) {
    completeLockfile(workspaceRoot)
  }
}

/**
 * Links sibling C++ libraries into a C++ project; any other package is not wired yet.
 *
 * @remarks
 * A package that names another C++ project of the workspace is added to the consumer's `CMakeLists.txt`
 * (`add_subdirectory` and `target_link_libraries`). Anything else would come from a package manager (vcpkg or Conan), which is
 * not wired yet (#473): that is said, and the exit code is set, rather than doing nothing and looking as if it worked.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The C++ project that gains the dependencies.
 * @param packages - The packages to add, by name.
 * @param locations - Every project of the workspace.
 * @returns Nothing.
 * @throws Never - an unreadable file is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function linkCmakeSiblings (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  locations: readonly ProjectLocation[],
): void {
  const siblings = new Map(
    locations
      .filter(candidate => candidate.ecosystem === 'cmake' && candidate.dir !== location.dir)
      .map(candidate => [candidate.name, candidate] as const),
  )
  const external: string[] = []
  for (const name of packages) {
    const sibling = siblings.get(name)
    if (sibling === undefined) {
      external.push(name)
      continue
    }
    const relativePath = relative(join(workspaceRoot, location.dir), join(workspaceRoot, sibling.dir)).split(sep).join('/')
    const text = readFileSync(location.manifestPath, 'utf8')
    const next = addCmakeSibling(text, relativePath, sibling.name, location.name)
    if (next === text) {
      logger.info(`${name} is already linked into ${location.dir} — left as is`)
    } else {
      writeFileEnsured(location.manifestPath, next)
      logger.step(`${location.dir}: linked ${name} (add_subdirectory ${relativePath})`)
    }
  }
  if (external.length > 0) {
    // Not a project of this workspace, so it is a vcpkg port: the project's own manifest, never the root's.
    addVcpkgPorts(workspaceRoot, location, external)
  }
}

/**
 * Adds crates to one Rust project: a sibling crate by path, the rest from the registry.
 *
 * @remarks
 * A package that is another crate of this workspace is a path dependency, which is how an internal library is consumed:
 * `cargo add --path` writes the crate's version beside the path, so a publishable crate that depends on one still publishes
 * once that one is. The remaining names are added from the registry in one call. The manifest path names the crate exactly,
 * whatever its package is called (an adopted crate need not match its folder).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The crate that gains the dependencies.
 * @param packages - The crates to add, by name (a registry spec such as `serde@1` is passed on as typed).
 * @param saveDev - Whether to add as a development dependency.
 * @param locations - Every project of the workspace.
 * @returns Nothing.
 * @throws Never - a failed cargo command is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function addCrates (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  saveDev: boolean,
  locations: readonly ProjectLocation[],
): void {
  const devFlag = saveDev ? ['--dev'] : []
  const siblings = new Map(
    locations
      .filter(candidate => candidate.ecosystem === 'cargo' && candidate.dir !== location.dir)
      .map(candidate => [candidate.name, candidate] as const),
  )
  const registry: string[] = []
  const paths: Array<[string, string]> = []
  for (const name of packages) {
    const sibling = siblings.get(name)
    if (sibling === undefined) {
      registry.push(name)
    } else {
      // Relative to where cargo runs (the workspace root), not to the manifest: cargo writes the path the manifest needs.
      paths.push([name, sibling.dir])
    }
  }
  if (registry.length > 0) {
    shell(workspaceRoot, 'cargo', ['add', ...registry, ...devFlag, '--manifest-path', location.manifestPath], location)
  }
  for (const [name, path] of paths) {
    shell(workspaceRoot, 'cargo', ['add', name, '--path', path, ...devFlag, '--manifest-path', location.manifestPath], location)
  }
}

/**
 * Adds packages to one project, or installs it, using its own toolchain.
 *
 * @remarks
 * Each ecosystem has a native add verb except pip, which has no "add to
 * pyproject" command — so the pip path edits the manifest ({@link addPipDependency})
 * and then runs the workspace's editable install. npm adds through its own
 * workspace flag from the root; the others run in the project directory.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The resolved target project.
 * @param packages - The packages to add, verbatim; empty to install only.
 * @param saveDev - Whether to add as a dev dependency where the ecosystem supports it.
 * @param locations - Every project of the workspace, so a package that names a sibling crate resolves to its path.
 * @returns Nothing.
 * @throws Never - a failed native command is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function installInto (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  saveDev: boolean,
  locations: readonly ProjectLocation[],
): void {
  const projectDir = join(workspaceRoot, location.dir)

  switch (location.ecosystem) {
    case 'npm': {
      const flags = saveDev ? ['--save-dev'] : []

      shell(workspaceRoot, 'npm', ['install', ...packages, ...flags, '-w', location.dir], location)

      return
    }
    case 'go': {
      shell(projectDir, 'go', packages.length > 0 ? ['get', ...packages] : ['mod', 'download'], location)
      if (packages.length > 0) {
        // Keep the workspace's module set consistent after a new require.
        runShell('go', ['work', 'sync'], workspaceRoot)
      }

      return
    }
    case 'nuget': {
      if (packages.length === 0) {
        shell(workspaceRoot, 'dotnet', ['restore', location.manifestPath], location)

        return
      }
      for (const specifier of packages) {
        const [name, version] = splitAtLast(specifier, '@')
        const versionFlag = version === undefined ? [] : ['--version', version]

        shell(workspaceRoot, 'dotnet', ['add', location.manifestPath, 'package', name, ...versionFlag], location)
      }

      return
    }
    case 'cargo': {
      // The manifest path names the crate exactly, whatever its package is called (an adopted crate need not match its folder).
      if (packages.length === 0) {
        shell(workspaceRoot, 'cargo', ['fetch', '--manifest-path', location.manifestPath], location)

        return
      }
      addCrates(workspaceRoot, location, packages, saveDev, locations)

      return
    }
    case 'cmake': {
      linkCmakeSiblings(workspaceRoot, location, packages, locations)

      return
    }
    case 'maven': {
      addMavenDependencies(workspaceRoot, location, packages, saveDev, locations)

      return
    }
    case 'gradle': {
      addGradleDependencies(workspaceRoot, location, packages, saveDev, locations)

      return
    }
    case 'composer': {
      addComposerPackages(workspaceRoot, location, packages, saveDev, locations)

      return
    }
    case 'bundler': {
      addBundlerGems(workspaceRoot, location, packages, saveDev, locations)

      return
    }
    case 'pub': {
      const devFlag = saveDev ? ['--dev'] : []

      shell(
        projectDir,
        'flutter',
        packages.length > 0 ? ['pub', 'add', ...devFlag, ...packages] : ['pub', 'get'],
        location,
      )

      return
    }
    case 'pip': {
      if (saveDev) {
        logger.warn(
          'pip has no per-project dev-dependency section — adding to [project].dependencies (dev tools live in the root requirements-dev.txt)',
        )
      }
      for (const specifier of packages) {
        addPythonDependency(location.manifestPath, specifier)
      }
      installEverything(workspaceRoot, ['pip'])

      return
    }
  }
}

/**
 * Adds one dependency to a project's `pyproject.toml`.
 *
 * @param manifestPath - Absolute path to the project's `pyproject.toml`.
 * @param specifier - The requirement to add, verbatim.
 * @returns Nothing.
 * @throws Never - an unreadable manifest is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function addPythonDependency (manifestPath: string, specifier: string): void {
  let content: string
  try {
    content = readFileSync(manifestPath, 'utf8')
  } catch {
    logger.warn(`Could not read ${manifestPath} — skipped ${specifier}`)

    return
  }
  const updated = addPipDependency(content, specifier)
  if (updated === content) {
    logger.info(`${specifier} is already declared — left as is`)

    return
  }
  writeFileEnsured(manifestPath, updated)
  logger.step(`Added ${specifier} to ${manifestPath}`)
}

/**
 * Installs or restores every ecosystem present in the workspace.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param only - Restrict to these ecosystems; defaults to all of them.
 * @returns Nothing.
 * @throws Never - a failed install is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function installEverything (
  workspaceRoot: string,
  only?: readonly Ecosystem[],
): void {
  for (const [ecosystem, command, arguments_] of WHOLE_WORKSPACE_INSTALL) {
    if (only !== undefined && !only.includes(ecosystem)) {
      continue
    }
    if (!hasEcosystem(workspaceRoot, ecosystem)) {
      continue
    }
    logger.step(`Installing ${ecosystem} dependencies (${command} ${arguments_.join(' ')})`)
    if (runShell(command, [...arguments_], workspaceRoot) !== 0) {
      logger.warn(`${command} ${arguments_.join(' ')} failed — re-run it once the cause is fixed`)
    }
    if (ecosystem === 'npm') {
      completeLockfile(workspaceRoot)
    }
  }
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

/**
 * Splits a string on the last occurrence of a separator.
 *
 * @remarks
 * Used to peel a version off a `name@version` NuGet specifier while leaving a
 * scoped-package-style name that itself contains the separator intact.
 *
 * @param value - The string to split.
 * @param separator - The single-character separator.
 * @returns The part before and after the last separator; the second is `undefined` when absent.
 * @throws Never - pure string work.
 * @typeParam None - this function has no generic type parameters.
 */
function splitAtLast (value: string, separator: string): [string, string | undefined] {
  const at = value.lastIndexOf(separator)
  if (at <= 0) {
    return [value, undefined]
  }

  return [value.slice(0, at), value.slice(at + 1)]
}
