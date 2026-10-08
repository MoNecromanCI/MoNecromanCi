import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { runCapture } from '../nx-workspace'

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

/** A plugin entry in `nx.json`: a bare name, or an object with options. */
type PluginEntry = string | { plugin?: string, options?: { modulePrefix?: string } }

/** The slice of `nx.json` this module reads and writes. */
interface NxJsonWithPlugins {
  plugins?: PluginEntry[]
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
 * Turns a git remote URL into a Go module prefix: the host and path, with no scheme,
 * credentials or trailing `.git`.
 *
 * @remarks
 * A Go module path must be a real VCS location, so `github.com/MoNecromanCI/MoNecromanCi`
 * — not the npm-scope-derived name — is what makes a per-project module (`<prefix>/<dir>`)
 * `go get`-able (#289, closing the old #236). Handles the `https://`/`ssh://` forms and the
 * scp-like `git@host:org/repo` form, strips any `user:pass@` credentials and a trailing
 * `.git`, and leaves case untouched (Go module paths are case-sensitive).
 *
 * @param url - A git remote URL.
 * @returns The module prefix, or `undefined` for an empty or unrecognisable URL.
 * @throws Never - pure string work.
 * @typeParam None - this function has no generic type parameters.
 */
export function modulePrefixFromRemoteUrl (url: string): string | undefined {
  const trimmed = url.trim()
  const scpLike = /^[^@/]+@([^:]+):(.+)$/.exec(trimmed)
  const withScheme = /^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?(.+)$/i.exec(trimmed)
  let path: string | undefined
  if (scpLike) {
    path = `${scpLike[1]}/${scpLike[2]}`
  } else if (withScheme) {
    path = withScheme[1]
  }
  if (path === undefined) {
    return undefined
  }
  const cleaned = path.replace(/\.git$/, '').replace(/\/+$/, '')

  return cleaned === '' ? undefined : cleaned
}

/**
 * The Go module prefix for this workspace, read from its `origin` git remote.
 *
 * @remarks
 * Used to give every per-project `go.mod` a fetchable module path (`<prefix>/<projectDir>`)
 * via the `@nx-go/nx-go` plugin's `modulePrefix` option. `undefined` when there is no
 * resolvable `origin` (a brand-new local repo), in which case the caller keeps the plugin's
 * own scope-derived default rather than inventing one.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The module prefix, or `undefined` when `origin` is absent or unreadable.
 * @throws Never - a failed `git` call yields `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
export function goModulePrefix (workspaceRoot: string): string | undefined {
  const result = runCapture('git', ['remote', 'get-url', 'origin'], workspaceRoot)

  return result.status === 0 ? modulePrefixFromRemoteUrl(result.stdout) : undefined
}

/**
 * The module path a root `go.mod` declares.
 *
 * @remarks
 * Present in an adopted flat repository, absent in a multi-module workspace, where each project owns its `go.mod`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The `module` line's path, or `undefined` when there is no root `go.mod` (a multi-module workspace).
 * @throws Never - an unreadable file has no module.
 * @typeParam None - this function has no generic type parameters.
 */
function rootModulePath (workspaceRoot: string): string | undefined {
  try {
    return /^module\s+(\S+)/m.exec(readFileSync(join(workspaceRoot, 'go.mod'), 'utf8'))?.[1]
  } catch {
    return undefined
  }
}

/**
 * Registers the Go plugin in `nx.json`, with a `modulePrefix` option when one is derivable.
 *
 * @remarks
 * The plugin's own `init` generator registers it too (as a bare name), but only when mnci
 * bootstraps the workspace module; a repository that already has one (an adopted Go module)
 * used to skip it, leaving the plugin installed but unregistered, so `nx affected` knew no
 * Go edge. This also sets the plugin's `modulePrefix` ({@link goModulePrefix}) so each
 * project's `go.mod` gets a fetchable path — **upgrading** an existing bare registration
 * (the one `init` writes) to carry it. Idempotent: no change when the plugin is already
 * registered with the same prefix (or when none is derivable and it is already present).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Whether `nx.json` changed.
 * @throws Error when `nx.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function registerNxGoPlugin (workspaceRoot: string): boolean {
  const nxJsonPath = join(workspaceRoot, 'nx.json')
  if (!fileExists(nxJsonPath)) {
    return false
  }
  // A repository with its own root go.mod is a single module that nothing here generates per-project modules for,
  // so a prefix taken from the git remote would only disagree with the module it names (#390). It gets none, and
  // any prefix already in nx.json is left as it is.
  const modulePrefix = rootModulePath(workspaceRoot) === undefined ? goModulePrefix(workspaceRoot) : undefined
  const entry: PluginEntry = modulePrefix === undefined ? NX_GO_PLUGIN : { plugin: NX_GO_PLUGIN, options: { modulePrefix } }
  const nxJson = readJson<NxJsonWithPlugins>(nxJsonPath)
  const plugins = [...(nxJson.plugins ?? [])]
  const index = plugins.findIndex(plugin => (typeof plugin === 'string' ? plugin : plugin.plugin) === NX_GO_PLUGIN)
  if (index === -1) {
    plugins.push(entry)
  } else {
    const current = plugins[index]
    const currentPrefix = typeof current === 'string' ? undefined : current.options?.modulePrefix
    if (modulePrefix === undefined || currentPrefix === modulePrefix) {
      return false
    }
    plugins[index] = entry
  }
  writeFileEnsured(nxJsonPath, toJson({ ...nxJson, plugins }))

  return true
}
