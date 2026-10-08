import { join } from 'node:path'
import { readJson, toJson, writeFileEnsured } from '../file-system'
import { appSharesOutputFolder, findReactAppsSharingOutput } from './find-react-apps-sharing-output.use-case'

/**
 * Moves one app's `tsc` output out of the folder Vite writes its bundle to.
 *
 * @remarks
 * `out-tsc` is already in the generated `.gitignore` and in the app's `tsconfig.app.json` `exclude`, so nothing
 * else has to move. Idempotent: an app whose output is already elsewhere is left as it is.
 *
 * @param appRoot - Absolute path to the app.
 * @returns True when the app's tsconfig was changed.
 * @throws Error when the app's `tsconfig.app.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function separateReactAppOutput (appRoot: string): boolean {
  if (!appSharesOutputFolder(appRoot)) {
    return false
  }
  const tsconfigPath = join(appRoot, 'tsconfig.app.json')
  const tsconfig = readJson<{ compilerOptions?: Record<string, unknown> } & Record<string, unknown>>(tsconfigPath)
  writeFileEnsured(tsconfigPath, toJson({
    ...tsconfig,
    compilerOptions: { ...tsconfig.compilerOptions, outDir: 'out-tsc/app', tsBuildInfoFile: 'out-tsc/app/tsconfig.app.tsbuildinfo' },
  }))

  return true
}

/**
 * Repairs every app of a workspace that has the shared output folder.
 *
 * @remarks
 * What `mnci upgrade` runs, so a workspace generated before the fix stops having an intermittent TS6305.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The app directories that were changed, workspace-relative.
 * @throws Error when an app's `tsconfig.app.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function separateReactAppsOutput (workspaceRoot: string): string[] {
  const repaired: string[] = []
  for (const dir of findReactAppsSharingOutput(workspaceRoot)) {
    if (separateReactAppOutput(join(workspaceRoot, dir))) {
      repaired.push(dir)
    }
  }

  return repaired
}
