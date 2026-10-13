import { globSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isEslintLinted } from './eslint-project.algorithm'

/**
 * One project ESLint lints.
 *
 * @remarks
 * The Nx name is what `nx show projects` reports, so a plan can check it; the folder is what ESLint is given.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface EslintProject {
  /** The Nx project name. */
  readonly name: string
  /** The folder, relative to the workspace root, forward-slashed. */
  readonly dir:  string
}

/**
 * Reads a JSON file's top-level object.
 *
 * @param path - Absolute path.
 * @returns The object, or `undefined` when the file is missing or not an object.
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
 * The text of a `lint` target: its executor and command, for a test against the tool's name.
 *
 * @param targets - A `targets` object.
 * @returns The text, or `undefined` when there is no `lint` target.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function lintTargetText (targets: unknown): string | undefined {
  const lint = typeof targets === 'object' && targets !== null ? (targets as Record<string, unknown>)['lint'] : undefined
  if (lint === undefined) {
    return undefined
  }

  return JSON.stringify(lint)
}

/**
 * Finds the projects whose lint is ESLint, by reading their manifests.
 *
 * @remarks
 * Looks under `apps`, `libs` and `packages` for a `package.json`, takes the Nx name the way Nx does (`project.json` name,
 * then `nx.name`, then the package name, then the folder), and keeps those {@link isEslintLinted} accepts. A project whose
 * name cannot be told apart from Nx's is caught by the caller, which checks every name against `nx show projects` and falls
 * back to Nx when one is missing.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The projects, sorted by folder.
 * @throws Never - an unreadable manifest is skipped.
 * @typeParam None - this function has no generic type parameters.
 */
export function locateEslintProjects (workspaceRoot: string): EslintProject[] {
  const found: EslintProject[] = []
  const manifests = globSync('{apps,libs,packages}/*/package.json', { cwd: workspaceRoot })
  for (const manifest of manifests) {
    const dir = dirname(manifest).replaceAll('\\', '/')
    const packageJson = readObject(join(workspaceRoot, manifest))
    const projectJson = readObject(join(workspaceRoot, dir, 'project.json'))
    const nx = packageJson?.['nx'] as { name?: unknown, targets?: unknown } | undefined
    const lintTarget = lintTargetText(projectJson?.['targets']) ?? lintTargetText(nx?.targets)
    if (!isEslintLinted({ hasPackageJson: true, lintTarget })) {
      continue
    }
    const named = [projectJson?.['name'], nx?.name, packageJson?.['name']].find((value): value is string => typeof value === 'string')
    found.push({ name: named ?? basename(dir), dir })
  }

  return found.toSorted((a, b) => a.dir.localeCompare(b.dir))
}
