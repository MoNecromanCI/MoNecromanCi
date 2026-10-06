import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runShell } from '../nx-workspace'
import { hasStaleLocalRegistry, LOCAL_REGISTRY_LOCK_KEY, LOCAL_REGISTRY_PACKAGE } from './stale-local-registry.validator'

/**
 * What {@link pruneStaleLocalRegistry} did.
 *
 * @remarks
 * A non-zero status with `stale` set means the lockfile was edited but npm could not finish the re-resolve.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PruneResult {
  /** Whether the lockfile had a stale local registry to remove. */
  stale:  boolean
  /** The exit status of the re-resolve, `0` when there was nothing to do. */
  status: number
}

/**
 * Removes a leftover local registry, and the chain it brought, from the lockfile.
 *
 * @remarks
 * Deleting the one entry and re-resolving without touching `node_modules` is what works: npm then
 * drops everything only `verdaccio` reached (`braces` and the four packages above it) and does not
 * put it back, because nothing asks for it. Measured on a generated workspace: the lockfile fell by
 * the whole chain and `npm audit` went from six high advisories to none. The versions of everything
 * else are kept, so the lockfile does not otherwise move.
 *
 * The stale `devDependencies` line in the lockfile's own root entry is removed too, so the file does
 * not claim a dependency the manifest no longer has.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param resolve - Runs the lockfile-only install; the real npm by default.
 * @returns Whether anything was stale and how the re-resolve ended.
 * @throws Error when the lockfile cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function pruneStaleLocalRegistry (
  workspaceRoot: string,
  resolve: (command: string, arguments_: string[], cwd: string) => number = runShell,
): PruneResult {
  if (!hasStaleLocalRegistry(workspaceRoot)) {
    return { stale: false, status: 0 }
  }
  const lockPath = join(workspaceRoot, 'package-lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { packages: Record<string, { devDependencies?: Record<string, string> }> }
  Reflect.deleteProperty(lock.packages, LOCAL_REGISTRY_LOCK_KEY)
  const root = lock.packages['']
  if (root?.devDependencies !== undefined) {
    Reflect.deleteProperty(root.devDependencies, LOCAL_REGISTRY_PACKAGE)
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, undefined, 2)}\n`)

  return { stale: true, status: resolve('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], workspaceRoot) }
}
