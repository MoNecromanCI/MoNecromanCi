import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkspaceInstall } from './workspace-install.contract'

/**
 * Reads a JSON file's top-level object.
 *
 * @param path - Absolute path of the file.
 * @returns The object, or `undefined` when the file is missing or not a JSON object.
 * @throws Never - a failed read is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
function readObject (path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))

    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/**
 * The version a `package-lock.json` pins for `@mnci/cli`.
 *
 * @remarks
 * Lockfile versions 2 and 3 key it as `packages["node_modules/@mnci/cli"]`; version 1 as `dependencies["@mnci/cli"]`.
 *
 * @param lock - The parsed lockfile, or `undefined`.
 * @returns The pinned version, or `undefined`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function lockedVersion (lock: Record<string, unknown> | undefined): string | undefined {
  const entryIn = (block: string, key: string): unknown => {
    const entries = lock?.[block]

    return typeof entries === 'object' && entries !== null ? (entries as Record<string, unknown>)[key] : undefined
  }
  const entry = entryIn('packages', 'node_modules/@mnci/cli') ?? entryIn('dependencies', '@mnci/cli')
  const version = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)['version'] : undefined

  return typeof version === 'string' ? version : undefined
}

/**
 * Reads what a workspace declares and has installed of `@mnci/cli`.
 *
 * @remarks
 * `devDependencies` first, then `dependencies`: `mnci new` writes a dev dependency, but a team may have moved it.
 *
 * @param workspaceRoot - Absolute path of the workspace.
 * @returns The declared range and the installed version, each `undefined` when absent.
 * @throws Never - an unreadable file is an absent answer.
 * @typeParam None - this function has no generic type parameters.
 */
export function readWorkspaceInstall (workspaceRoot: string): WorkspaceInstall {
  const manifest = readObject(join(workspaceRoot, 'package.json'))
  const declaredIn = (block: string): string | undefined => {
    const entries = manifest?.[block]
    const range = typeof entries === 'object' && entries !== null ? (entries as Record<string, unknown>)['@mnci/cli'] : undefined

    return typeof range === 'string' ? range : undefined
  }
  const installed = readObject(join(workspaceRoot, 'node_modules', '@mnci', 'cli', 'package.json'))?.['version']

  return {
    declared:  declaredIn('devDependencies') ?? declaredIn('dependencies'),
    installed: typeof installed === 'string' ? installed : undefined,
    locked:    lockedVersion(readObject(join(workspaceRoot, 'package-lock.json'))),
  }
}
