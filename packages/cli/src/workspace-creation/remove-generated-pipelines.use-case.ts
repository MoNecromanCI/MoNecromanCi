import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists } from '../file-system'

/** The pipeline files `create-nx-workspace` can write, which mnci owns and writes itself. */
const NX_GENERATED_PIPELINES: readonly string[] = ['.github/workflows/ci.yml', 'azure-pipelines.yml']

/**
 * Deletes the CI pipeline files that `create-nx-workspace` has just generated.
 *
 * @remarks
 * Newer `create-nx-workspace` versions write their own `.github/workflows/ci.yml` (with Nx Cloud steps) even when
 * Nx Cloud is skipped. mnci owns the pipeline and writes it in the overlay step, but that step merges with a file
 * already there, and a file with no mnci markers is read as a legacy pipeline: every Nx step becomes a "team step"
 * kept in the first slot, and, because the file has no pack or release step, those two phases are switched off.
 * A brand-new workspace then ran Nx's redundant steps and never released.
 *
 * Call this on the freshly generated tree only, before it is adopted into anything. A pipeline a team already has
 * in a repository it is adopting is a different file and is migrated, not removed.
 *
 * @param generatedRoot - Absolute path to the workspace `create-nx-workspace` just wrote.
 * @returns The workspace-relative paths that were removed.
 * @throws Never - a missing file is simply not there.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeGeneratedPipelines (generatedRoot: string): string[] {
  const removed: string[] = []
  for (const file of NX_GENERATED_PIPELINES) {
    if (!fileExists(join(generatedRoot, file))) {
      continue
    }

    rmSync(join(generatedRoot, file), { force: true })
    removed.push(file)
  }

  return removed
}
