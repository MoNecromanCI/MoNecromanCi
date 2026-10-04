import { globSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runShell } from '../nx-workspace'
import { detectCiHost, groupEnd, groupStart } from './ci-environment.client'
import type { CiDependencies } from './phase.contract'

/**
 * Whether the workspace has any app to pack.
 *
 * @remarks
 * The three shapes an `apps/*` project takes, matching the inline guard branch for branch: a
 * `project.json` (the usual Nx project), an inline `nx` block in its `package.json` (a
 * TypeScript-solution project with no `project.json`), or a `.csproj` (a C# project, which
 * `@nx/dotnet` infers without either). An unreadable or malformed `package.json` counts as no
 * inline block, never a throw, so a half-written manifest cannot fail the pack step.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns True when at least one `apps/*` project exists in any of those shapes.
 * @throws Never - a malformed manifest counts as not an app.
 * @typeParam None - this function has no generic type parameters.
 */
function hasAppToPack (workspaceRoot: string): boolean {
  const hasProjectJson = globSync('apps/*/project.json', { cwd: workspaceRoot }).length > 0
  const hasInlineNx = globSync('apps/*/package.json', { cwd: workspaceRoot }).some((manifest) => {
    try {
      const parsed = JSON.parse(readFileSync(join(workspaceRoot, manifest), 'utf8')) as { nx?: unknown }

      return Boolean(parsed.nx)
    } catch {
      return false
    }
  })
  const hasCsproj = globSync('apps/*/*.csproj', { cwd: workspaceRoot }).length > 0

  return hasProjectJson || hasInlineNx || hasCsproj
}

/**
 * Runs the pack phase: every app's `package` target into `dist/drop/<type>-<name>.zip`.
 *
 * @remarks
 * Ported from the inline `node -e` guard the generated pipelines carry (`PACK_APPS_GUARD`),
 * branch for branch, so a pipeline switched over to `mnci ci pack` packs exactly what it did:
 *
 * - **`dist/drop` is created first**, whether or not there is anything to pack, because the
 *   pipeline's `upload-artifact` step points at it with `if-no-files-found: ignore` and a
 *   missing directory is a different failure from an empty one.
 * - **No apps is a clean skip, not a failure** ({@link hasAppToPack}): a workspace can run CI
 *   before it has added one, and `nx run-many -t package` errors on an empty project set.
 * - Otherwise it runs **`npx nx run-many -t package`**, and that command's status is the
 *   phase's.
 *
 * The one difference from the guard cannot change a result: the run sits inside a log group,
 * which the pipeline left to its step's own collapsing.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The environment, the process runner and the logger; real ones by default.
 * @returns The exit status: 0 when packed or skipped, otherwise the `package` run's.
 * @throws Never - a command that fails is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export function runPack (workspaceRoot: string, dependencies: Partial<CiDependencies> = {}): number {
  const environment = dependencies.environment ?? process.env
  const processes = dependencies.processes ?? {
    run:     (command, arguments_) => runShell(command, arguments_, workspaceRoot),
    capture: () => ({ status: 1, stdout: '' }),
  }
  const log = dependencies.log ?? ((message: string) => { console.log(message) })
  const host = detectCiHost(environment)

  mkdirSync(join(workspaceRoot, 'dist', 'drop'), { recursive: true })
  if (!hasAppToPack(workspaceRoot)) {
    log('No apps to pack - skipping.')

    return 0
  }

  log(groupStart(host, 'Pack all apps'))
  const status = processes.run('npx', ['nx', 'run-many', '-t', 'package'])
  const closing = groupEnd(host)
  if (closing !== undefined) {
    log(closing)
  }

  return status
}
