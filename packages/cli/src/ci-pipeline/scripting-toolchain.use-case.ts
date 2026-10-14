import { globSync } from 'node:fs'
import { PHP_VERSION, RUBY_VERSION } from '../workspace-overlay'
import type { CiProcesses } from './phase.contract'

/** The folders a PHP or Ruby project lives in. */
const PROJECT_ROOTS = ['apps', 'packages', 'libs']

/**
 * Whether the workspace holds a project that has the given manifest.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param manifest - The file name that marks the project (`composer.json`, `Gemfile`).
 * @returns True when at least one project folder has it.
 * @throws Never - an unreadable folder holds none.
 * @typeParam None - this function has no generic type parameters.
 */
function hasProject (workspaceRoot: string, manifest: string): boolean {
  return PROJECT_ROOTS.some(root => globSync(`${root}/*/${manifest}`, { cwd: workspaceRoot }).length > 0)
}

/**
 * The `major.minor` of a version in a tool's own `--version` output.
 *
 * @param text - Output such as `PHP 8.4.25 (cli)` or `ruby 3.4.11p100`.
 * @returns The first `major.minor` found, or `undefined`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function majorMinor (text: string): string | undefined {
  return /(\d+\.\d+)/.exec(text)?.[1]
}

/**
 * Warns when a language's runtime is absent or is not the pinned minor, and when its package tool is absent.
 *
 * @param runtime - The runtime's display name and the command that answers `--version`.
 * @param pinned - The pinned `major.minor`.
 * @param packageTool - The package tool's display name and the command that answers `--version`.
 * @param processes - The process runner.
 * @param log - The logger.
 * @throws Never - a missing tool is a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function checkRuntime (
  runtime: { readonly name: string, readonly command: string },
  pinned: string,
  packageTool: { readonly name: string, readonly command: string },
  processes: CiProcesses,
  log: (message: string) => void,
): void {
  const found = processes.capture(runtime.command, ['--version'])
  if (found.status === 0) {
    const version = majorMinor(found.stdout)
    if (version !== undefined && version !== pinned) {
      log(`Warning: this runner's ${runtime.name} ${version} is not ${pinned}, which the projects were verified with.`)
    } else {
      log(`${runtime.name} ${version ?? pinned} found.`)
    }
  } else {
    log(`Warning: ${runtime.name} was not found on PATH; mnci's projects were verified with ${runtime.name} ${pinned}.`)
  }
  if (processes.capture(packageTool.command, ['--version']).status !== 0) {
    log(`Warning: ${packageTool.name} was not found on PATH.`)
  }
}

/**
 * Checks the PHP and Ruby toolchains of a workspace that has projects in those languages.
 *
 * @remarks
 * Nothing is installed or selected: the hosted images carry PHP with Composer and Ruby with Bundler, and a version other
 * than {@link PHP_VERSION} or {@link RUBY_VERSION} is named, because the build would otherwise fail later with a message
 * about the language rather than the runner. The devcontainer provisions both at the pins.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0: this step informs, it does not fail a build the toolchain itself will judge.
 * @throws Never - a missing tool is a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function checkScriptingToolchains (
  workspaceRoot: string,
  processes: CiProcesses,
  log: (message: string) => void,
): number {
  const php = hasProject(workspaceRoot, 'composer.json')
  const ruby = hasProject(workspaceRoot, 'Gemfile')
  if (!php && !ruby) {
    log('No PHP or Ruby projects - skipping.')

    return 0
  }
  if (php) {
    checkRuntime({ name: 'PHP', command: 'php' }, PHP_VERSION, { name: 'Composer', command: 'composer' }, processes, log)
  }
  if (ruby) {
    checkRuntime({ name: 'Ruby', command: 'ruby' }, RUBY_VERSION, { name: 'Bundler', command: 'bundle' }, processes, log)
  }

  return 0
}
