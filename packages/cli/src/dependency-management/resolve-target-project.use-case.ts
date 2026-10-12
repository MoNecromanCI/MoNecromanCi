import { logger } from '../terminal'
import { type ProjectLocation } from './manifest.repository'

/**
 * Resolves a `-w` argument to exactly one project.
 *
 * @remarks
 * A project is addressable by its directory (`apps/goapi`) or its basename
 * (`goapi`). A directory match is exact and wins; a basename that matches more
 * than one project (two ecosystems sharing a folder name) is ambiguous, so the
 * caller is told to use the directory instead of a guess being made. Shared by
 * `mnci install` and `mnci uninstall`, which address a project the same way.
 *
 * @param locations - Every located project.
 * @param target - The `-w` argument.
 * @returns The single matching project, or `undefined` when none or many match.
 * @throws Never - a lookup that finds nothing or several says so and returns `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
export function resolveTarget (
  locations: readonly ProjectLocation[],
  target: string,
): ProjectLocation | undefined {
  const byDir = locations.filter(location => location.dir === target)
  if (byDir.length > 0) {
    return preferred(byDir)
  }
  const byName = locations.filter(location => location.name === target)
  const directories = [...new Set(byName.map(match => match.dir))]
  if (directories.length > 1) {
    logger.error(
      `'${target}' matches ${directories.length} projects (${directories.join(', ')}) — name it by directory`,
    )

    return undefined
  }

  return preferred(byName)
}

/**
 * Chooses the project's own toolchain among the manifests one folder holds.
 *
 * @remarks
 * A Laravel app is a Composer project that also ships a `package.json` for its front-end assets, and a Rails app likewise;
 * the folder is one project, and its dependencies belong to the framework's package manager. npm is therefore only the
 * answer when nothing else owns the folder.
 *
 * @param candidates - The manifests found in one folder (or none).
 * @returns The non-npm one when there is one, else the first; `undefined` for none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function preferred (candidates: readonly ProjectLocation[]): ProjectLocation | undefined {
  return candidates.find(candidate => candidate.ecosystem !== 'npm') ?? candidates[0]
}
