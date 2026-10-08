import { join } from 'node:path'
import { fileExists, readJson } from '../file-system'

/** The suffix of the root script `mnci add` registers for a project that can be started. */
const START_SUFFIX = ':start'

/** `nx run <project>:<target>`, the command the registered script runs. */
const NX_RUN = /\bnx run [^\s:]+:(\S+)/

/**
 * A project that has a start command, and the Nx target that command runs.
 *
 * @remarks
 * The target is not always `start`: a React or Node app's `<name>:start` script runs its `serve` target, a Go app's
 * runs `start`. Reading it from the script is what makes both work.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface StartableProject {
  /** The project name. */
  project: string
  /** The Nx target its start command runs. */
  target:  string
}

/**
 * Lists the projects of a workspace that have a `start` command, with the Nx target each one runs.
 *
 * @remarks
 * Read from the root `package.json`, where `mnci add` registers `<name>:start` for every app that has a local
 * dev-server story (never a library). That is quick and is exactly what mnci says can be started, with no Nx
 * start-up to ask. A script that is not `nx run <project>:<target>` falls back to the `start` target.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The projects, sorted by name.
 * @throws Error when the root `package.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function listStartableProjects (workspaceRoot: string): StartableProject[] {
  const manifestPath = join(workspaceRoot, 'package.json')
  if (!fileExists(manifestPath)) {
    return []
  }
  const scripts = readJson<{ scripts?: Record<string, string> }>(manifestPath).scripts ?? {}

  return Object.entries(scripts)
    .filter(([script]) => script.endsWith(START_SUFFIX))
    .map(([script, command]) => ({ project: script.slice(0, -START_SUFFIX.length), target: NX_RUN.exec(command)?.[1] ?? 'start' }))
    .toSorted((a, b) => a.project.localeCompare(b.project))
}
