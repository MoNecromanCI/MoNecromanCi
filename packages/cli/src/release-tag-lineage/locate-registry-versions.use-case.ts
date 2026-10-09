import { runCapture } from '../nx-workspace'

/**
 * Asks the registry the workspace publishes to for the newest version of each project.
 *
 * @remarks
 * Through `npm view`, so the registry, its scope routing and its credentials are whatever the
 * workspace's `.npmrc` says; nothing is called by hand. A project the registry does not know, or
 * one that cannot be reached, is left out of the answer rather than guessed.
 *
 * @param workspaceRoot - Absolute path to the workspace, where `npm` finds the `.npmrc`.
 * @param projects - The package names to look up.
 * @returns The newest published version per name.
 * @throws Never - a failed lookup leaves the name out.
 * @typeParam None - this function has no generic type parameters.
 */
export function locateRegistryVersions (workspaceRoot: string, projects: readonly string[]): Map<string, string> {
  const versions = new Map<string, string>()
  for (const project of projects) {
    const viewed = runCapture('npm', ['view', project, 'version', '--fetch-retries=0', '--fetch-timeout=15000'], workspaceRoot)
    const version = viewed.stdout.trim()
    if (version !== '' && viewed.status === 0) {
      versions.set(project, version)
    }
  }

  return versions
}
