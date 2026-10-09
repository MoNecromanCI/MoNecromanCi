import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists } from '../file-system'
import { parseGoWorkUses } from './go-work-uses.algorithm'

/**
 * The Go module directories of a workspace, or `undefined` when it has no Go at all.
 *
 * @remarks
 * Two layouts exist. A multi-module workspace (what `mnci add go-*` creates) has a root `go.work` listing one
 * directory per project and no root `go.mod`; an adopted flat repository has a root `go.mod` and no `go.work`.
 * Anything that asks "does this workspace have Go projects" must accept either: checking only the root `go.mod`
 * made every CI Go step skip itself in a multi-module workspace, so `golangci-lint` was never installed.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The module directories relative to the root (`.` for a root module), an empty list for a `go.work`
 * with no `use` entries, or `undefined` when there is neither a `go.work` nor a root `go.mod`.
 * @throws Never - an unreadable `go.work` lists nothing.
 * @typeParam None - this function has no generic type parameters.
 */
export function listGoModuleDirectories (workspaceRoot: string): string[] | undefined {
  const goWork = join(workspaceRoot, 'go.work')
  if (fileExists(goWork)) {
    try {
      return parseGoWorkUses(readFileSync(goWork, 'utf8'))
    } catch {
      return []
    }
  }

  return fileExists(join(workspaceRoot, 'go.mod')) ? ['.'] : undefined
}
