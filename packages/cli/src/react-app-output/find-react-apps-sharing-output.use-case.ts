import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson } from '../file-system'
import { sharesOutputFolder } from './react-app-output.policy'

/** The names a Vite config can have. */
const VITE_CONFIGS: readonly string[] = ['vite.config.mts', 'vite.config.ts', 'vite.config.mjs', 'vite.config.js']

/**
 * Whether one app's `tsc` and Vite write into the same folder.
 *
 * @remarks
 * An app with no Vite config (a Node app) or no `tsconfig.app.json` is not a React app and is never reported.
 *
 * @param appRoot - Absolute path to the app.
 * @returns True when it has a Vite config and a `tsconfig.app.json` whose `outDir` is Vite's.
 * @throws Never - an unreadable or commented tsconfig is not reported.
 * @typeParam None - this function has no generic type parameters.
 */
export function appSharesOutputFolder (appRoot: string): boolean {
  const config = VITE_CONFIGS.find(name => fileExists(join(appRoot, name)))
  const tsconfigPath = join(appRoot, 'tsconfig.app.json')
  if (config === undefined || !fileExists(tsconfigPath)) {
    return false
  }
  try {
    const outDir = readJson<{ compilerOptions?: { outDir?: string } }>(tsconfigPath).compilerOptions?.outDir

    return sharesOutputFolder(outDir, readFileSync(join(appRoot, config), 'utf8'))
  } catch {
    return false
  }
}

/**
 * Lists the apps of a workspace whose `tsc` and Vite write into the same folder.
 *
 * @remarks
 * Looks at every directory under `apps`, so a workspace generated before mnci stopped doing this is found.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The app directories, workspace-relative, sorted.
 * @throws Never - a workspace with no `apps` folder has none.
 * @typeParam None - this function has no generic type parameters.
 */
export function findReactAppsSharingOutput (workspaceRoot: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(join(workspaceRoot, 'apps'))
  } catch {
    return []
  }

  return entries
    .filter(entry => appSharesOutputFolder(join(workspaceRoot, 'apps', entry)))
    .map(entry => `apps/${entry}`)
    .toSorted((a, b) => a.localeCompare(b))
}
