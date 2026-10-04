import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runShell } from '../nx-workspace'
import { fileExists, writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import {
  type Ecosystem,
  type ProjectLocation,
  addPipDependency,
  hasEcosystem,
  locateProjects,
} from './manifest.repository'

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
    installInto(workspaceRoot, location, packages, Boolean(options.saveDev))
  }
}

/**
 * Resolves a `-w` argument to exactly one project.
 *
 * @remarks
 * A project is addressable by its directory (`apps/goapi`) or its basename
 * (`goapi`). A directory match is exact and wins; a basename that matches more
 * than one project (two ecosystems sharing a folder name) is ambiguous, so the
 * caller is told to use the directory instead of a guess being made.
 *
 * @param locations - Every located project.
 * @param target - The `-w` argument.
 * @returns The single matching project, or `undefined` when none or many match.
 * @throws Never - pure lookup.
 * @typeParam None - this function has no generic type parameters.
 */
function resolveTarget (
  locations: readonly ProjectLocation[],
  target: string,
): ProjectLocation | undefined {
  const byDir = locations.find(location => location.dir === target)
  if (byDir !== undefined) {
    return byDir
  }
  const byName = locations.filter(location => location.name === target)
  if (byName.length > 1) {
    logger.error(
      `'${target}' matches ${byName.length} projects (${byName.map(match => match.dir).join(', ')}) — name it by directory`,
    )

    return undefined
  }

  return byName[0]
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
 * @returns Nothing.
 * @throws Never - a failed native command is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function installInto (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  saveDev: boolean,
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
    if (!ecosystemPresent(workspaceRoot, ecosystem)) {
      continue
    }
    logger.step(`Installing ${ecosystem} dependencies (${command} ${arguments_.join(' ')})`)
    if (runShell(command, [...arguments_], workspaceRoot) !== 0) {
      logger.warn(`${command} ${arguments_.join(' ')} failed — re-run it once the cause is fixed`)
    }
  }
}

/**
 * Whether an ecosystem is present, reading Go the multi-module way.
 *
 * @remarks
 * Defers to {@link hasEcosystem} for everything but Go, whose check there is a
 * root `go.mod` — absent under multi-module (MoNecromanCI/MoNecromanCi#289), where the
 * `go.work` file is the workspace marker. Without this special case a bare
 * `mnci install` would silently skip `go work sync`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param ecosystem - The ecosystem to test for.
 * @returns `true` when the ecosystem is present.
 * @throws Never - only reads the filesystem.
 * @typeParam None - this function has no generic type parameters.
 */
function ecosystemPresent (workspaceRoot: string, ecosystem: Ecosystem): boolean {
  if (ecosystem === 'go') {
    return fileExists(join(workspaceRoot, 'go.work')) || fileExists(join(workspaceRoot, 'go.mod'))
  }

  return hasEcosystem(workspaceRoot, ecosystem)
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
