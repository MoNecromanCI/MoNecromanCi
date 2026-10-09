import { join } from 'node:path'
import { fileExists } from '../file-system'
import { runShell } from '../nx-workspace'
import { logger } from '../terminal'

/**
 * Brings Nx itself up to date with `nx migrate` (`mnci upgrade --migrate`, #312).
 *
 * @remarks
 * The three steps Nx documents: `nx migrate latest` rewrites the versions in `package.json` and writes `migrations.json`, an
 * install fetches them, and `nx migrate --run-migrations` applies the code changes. It is a flag and not part of every upgrade
 * because `latest` may be a major beyond what the installed mnci was verified with. A step that fails stops the rest and says
 * how to resume, since the overlay is already applied by then; `migrations.json` is left in place for review, as Nx advises.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns True when every step passed.
 * @throws Never - a failing step is reported and returned.
 * @typeParam None - this function has no generic type parameters.
 */
export function migrateNx (workspaceRoot: string): boolean {
  logger.step('Migrating Nx (nx migrate latest)')
  if (runShell('npx', ['nx', 'migrate', 'latest'], workspaceRoot) !== 0) {
    logger.warn('`nx migrate latest` failed, so Nx was not migrated. Run it by hand once the cause is fixed.')

    return false
  }
  if (!fileExists(join(workspaceRoot, 'migrations.json'))) {
    logger.detail('Nx is already up to date (no migrations.json was written)')

    return true
  }
  if (runShell('npm', ['install'], workspaceRoot) !== 0) {
    logger.warn('`npm install` failed after `nx migrate latest`. Fix it, then run `npx nx migrate --run-migrations`.')

    return false
  }
  if (runShell('npx', ['nx', 'migrate', '--run-migrations'], workspaceRoot) !== 0) {
    logger.warn('`nx migrate --run-migrations` failed. Fix the cause and run it again; migrations.json is still there.')

    return false
  }
  logger.detail('migrations.json is kept: review what the migrations changed, then delete it')

  return true
}
