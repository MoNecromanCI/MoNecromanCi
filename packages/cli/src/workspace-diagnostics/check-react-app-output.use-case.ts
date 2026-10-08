import { findReactAppsSharingOutput } from '../react-app-output'
import type { Finding } from './finding.contract'

/**
 * Checks that no React app's `tsc` writes into the folder Vite builds into.
 *
 * @remarks
 * Vite empties its output folder on every build and Nx has no dependency between an app's `build` and `typecheck`, so
 * when both write to `dist` the typecheck fails intermittently with TS6305 (#346). Only reported when an app has it,
 * since a workspace with none has nothing to say.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns A finding when at least one app shares the folder, otherwise none.
 * @throws Never - an unreadable app is not reported.
 * @typeParam None - this function has no generic type parameters.
 */
export function checkReactAppOutput (workspaceRoot: string): Finding | undefined {
  const apps = findReactAppsSharingOutput(workspaceRoot)
  if (apps.length === 0) {
    return undefined
  }

  return {
    check:  'React apps\' tsc output is not the folder Vite builds into',
    ok:     false,
    detail: `${apps.join(', ')}: tsconfig.app.json writes to the same folder as the Vite bundle, which Vite empties on each build, so build and typecheck running together fail intermittently with TS6305`,
    remedy: 'run `mnci upgrade`, which moves tsc output to out-tsc/app',
  }
}
