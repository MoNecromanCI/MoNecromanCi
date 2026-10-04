import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'

/**
 * The Nx plugin that works out which Go project imports which.
 *
 * @remarks
 * It supplies the project graph for Go (an app that imports `libs/core/x` depends on
 * `core`) and nothing mnci writes explicitly: targets are written into each
 * `project.json`. Without it `nx affected` knows no Go edge, so a change to a library
 * passes CI without testing the apps that use it, and nothing says so.
 */
export const NX_GO_PLUGIN = '@nx-go/nx-go'

/** The slice of `nx.json` this module reads and writes. */
interface NxJsonWithPlugins {
  plugins?: (string | { plugin?: string })[]
}

/**
 * Whether the workspace has at least one Go project.
 *
 * @remarks
 * By tag, not by a `go.mod`: a root `go.mod` is also what an adopted repository
 * brings, before any Go project exists. A malformed `project.json` counts as not a Go
 * project, since another check owns telling the user about it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns True when an `apps`, `libs` or `packages` project is tagged `type:go-*`.
 * @throws Never - an unreadable project file is skipped.
 * @typeParam None - this function has no generic type parameters.
 */
export function hasGoProject (workspaceRoot: string): boolean {
  const projectFiles = ['apps', 'libs', 'packages'].flatMap(directory => globSync(`${directory}/*/project.json`, { cwd: workspaceRoot }))

  return projectFiles.some((projectFile) => {
    try {
      const { tags } = JSON.parse(readFileSync(join(workspaceRoot, projectFile), 'utf8')) as { tags?: string[] }

      return (tags ?? []).some(tag => tag.startsWith('type:go-'))
    } catch {
      return false
    }
  })
}

/**
 * Whether `nx.json` lists the Go plugin, as a bare name or with options.
 *
 * @remarks
 * Both spellings count, because Nx accepts either and a workspace that wrote the plugin with
 * options is just as registered as one that wrote it as a string.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns True when it does. False when there is no `nx.json`.
 * @throws Error when `nx.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function isNxGoPluginRegistered (workspaceRoot: string): boolean {
  const nxJsonPath = join(workspaceRoot, 'nx.json')
  if (!fileExists(nxJsonPath)) {
    return false
  }

  return (readJson<NxJsonWithPlugins>(nxJsonPath).plugins ?? [])
    .some(entry => (typeof entry === 'string' ? entry : entry.plugin) === NX_GO_PLUGIN)
}

/**
 * Registers the Go plugin in `nx.json`, when it is not.
 *
 * @remarks
 * The plugin's own `init` generator does this too, but it also writes a `go.work`, which
 * is the multi-module layout mnci rejects (see `ensureGoModule`), and it is only run when
 * mnci creates the root `go.mod`. A repository that already has one (an adopted flat Go
 * module) used to skip it, leaving the plugin installed but unregistered: every target
 * worked, since they are written explicitly, and the project graph had no Go edge.
 * Appends the bare name, which is exactly what `init` writes. Idempotent.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Whether `nx.json` changed.
 * @throws Error when `nx.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function registerNxGoPlugin (workspaceRoot: string): boolean {
  const nxJsonPath = join(workspaceRoot, 'nx.json')
  if (!fileExists(nxJsonPath) || isNxGoPluginRegistered(workspaceRoot)) {
    return false
  }
  const nxJson = readJson<NxJsonWithPlugins>(nxJsonPath)
  writeFileEnsured(nxJsonPath, toJson({ ...nxJson, plugins: [...(nxJson.plugins ?? []), NX_GO_PLUGIN] }))

  return true
}
