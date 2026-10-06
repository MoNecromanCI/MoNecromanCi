import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package `@nx/js:lib --publishable` installs for a local registry mnci does not use.
 *
 * @remarks
 * Also an optional peer of `@nx/js` itself, which is why it can outlive the dependency that brought it.
 */
export const LOCAL_REGISTRY_PACKAGE = 'verdaccio'

/**
 * The lockfile entry that holds it.
 *
 * @remarks
 * The hoisted path npm writes for a package at the root of `node_modules`.
 */
export const LOCAL_REGISTRY_LOCK_KEY = `node_modules/${LOCAL_REGISTRY_PACKAGE}`

/** The dependency lists of a manifest, any of which counts as declaring a package. */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Reads a JSON file, or `undefined` when it is absent or not JSON.
 *
 * @param path - The file.
 * @returns The parsed value.
 * @throws Never - an unreadable file reads as absent.
 * @typeParam None - this function has no generic type parameters.
 */
function readJsonFile (path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Whether a manifest declares the local registry package itself.
 *
 * @param manifest - A parsed `package.json`.
 * @returns True when any dependency list names it.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function declaresLocalRegistry (manifest: Record<string, unknown> | undefined): boolean {
  return DEPENDENCY_FIELDS.some(field => {
    const list = manifest?.[field] as Record<string, unknown> | undefined

    return list !== undefined && Object.hasOwn(list, LOCAL_REGISTRY_PACKAGE)
  })
}

/**
 * Whether the lockfile still carries the local registry although no manifest asks for it.
 *
 * @remarks
 * `verdaccio` is an optional peer of `@nx/js`. npm does not install an optional peer on its own,
 * but once one is in the lockfile it counts as satisfying that peer and stays, with its whole
 * dependency chain, after the root dependency that brought it is removed. `braces`, in that chain,
 * has no patched release, so the first CI run of a fresh workspace fails its audit on a package
 * nothing uses. Neither a re-resolve in place nor `npm uninstall` clears it (measured).
 *
 * A manifest that declares it, the root's or any workspace member's, makes it deliberate. The
 * members are read off the lockfile (an entry that is not under `node_modules`).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns True when the lockfile has the entry and nothing declares it.
 * @throws Never - a workspace with no readable lockfile has nothing stale.
 * @typeParam None - this function has no generic type parameters.
 */
export function hasStaleLocalRegistry (workspaceRoot: string): boolean {
  const lock = readJsonFile(join(workspaceRoot, 'package-lock.json'))
  const entries = (lock?.packages ?? {}) as Record<string, unknown>
  if (!Object.hasOwn(entries, LOCAL_REGISTRY_LOCK_KEY)) {
    return false
  }
  const members = Object.keys(entries).filter(key => key !== '' && !key.startsWith('node_modules/') && !key.includes('/node_modules/'))
  const manifests = ['', ...members].map(directory => readJsonFile(join(workspaceRoot, directory, 'package.json')))

  return manifests.every(manifest => !declaresLocalRegistry(manifest))
}
