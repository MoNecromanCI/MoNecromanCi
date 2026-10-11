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
