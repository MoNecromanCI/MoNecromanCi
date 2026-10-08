/** The `outDir` Vite uses when its config does not set one. */
const VITE_DEFAULT_OUT_DIR = 'dist'

/** `outDir: '<folder>'` in a Vite config, in either quote style. */
const VITE_OUT_DIR = /\boutDir:\s*['"]([^'"]+)['"]/

/**
 * A folder name as a comparison key: no leading `./`, no trailing slash.
 *
 * @param folder - A folder as written in a config.
 * @returns The same folder in one spelling.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function normalise (folder: string): string {
  return folder.replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * The folder Vite writes an app's bundle to.
 *
 * @remarks
 * Read from the config text rather than by running Vite, which is slow and needs the app's dependencies installed.
 *
 * @param viteConfig - The text of the app's Vite config.
 * @returns Its `build.outDir`, or Vite's default `dist`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function viteOutputFolder (viteConfig: string): string {
  return normalise(VITE_OUT_DIR.exec(viteConfig)?.[1] ?? VITE_DEFAULT_OUT_DIR)
}

/**
 * Whether `tsc` and Vite write into the same folder.
 *
 * @remarks
 * They must not. Vite empties its output folder when it builds, and Nx has no dependency between an app's `build`
 * (Vite) and `typecheck` (`tsc --build`), so `nx run-many -t build typecheck` runs them together: Vite clears the
 * folder while `tsc` is emitting declarations and its `.tsbuildinfo` there, and the typecheck fails with TS6305
 * on some runs and not on others. `tsc`'s output is never used for an app, so the fix is to move it elsewhere.
 *
 * @param typescriptOutDir - `compilerOptions.outDir` of the app's `tsconfig.app.json`, when it has one.
 * @param viteConfig - The text of the app's Vite config.
 * @returns True when both write to the same folder.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function sharesOutputFolder (typescriptOutDir: string | undefined, viteConfig: string): boolean {
  return typescriptOutDir !== undefined && normalise(typescriptOutDir) === viteOutputFolder(viteConfig)
}
