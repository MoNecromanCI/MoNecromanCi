import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'

/**
 * Moves the app's declaration output out of the folder its own build empties.
 *
 * @remarks
 * `@nx/node:application --bundler=esbuild` (and `@nx/react:app` with Vite, whose
 * `vite.config` also empties `./dist`) writes `outDir: 'dist'` and
 * `tsBuildInfoFile: 'dist/...'` into `tsconfig.app.json`, while the build it
 * generates has `outputPath: 'apps/<name>/dist'` and empties that folder before
 * writing. Nx runs `typecheck` and `build` in parallel, so the build's clean
 * deletes the declarations `tsc --build` just wrote, and the spec project —
 * which references `tsconfig.app.json` — then fails with TS6305, reporting that
 * the output file in `dist` has not been built from its source file.
 *
 * Reproduced on a freshly generated workspace before changing anything: run the
 * app's typecheck, delete the `.d.ts` files the build's clean removes, run it
 * again, and TS6305 arrives every time. With the declarations in `out-tsc/app`
 * the same sequence passes.
 *
 * `out-tsc` is already in `tsconfig.app.json`'s `exclude` and in the generated
 * `.gitignore`, so nothing else has to move. The esbuild executor takes its
 * output from `outputPath`, never from the tsconfig, so `dist` is unchanged
 * apart from the tsbuildinfo no longer landing there.
 *
 * @param appRoot - Absolute path to the generated app's directory.
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error reading or writing the tsconfig.
 * @typeParam None - this function has no generic type parameters.
 */
export function separateDeclarationOutput (appRoot: string): void {
  const tsconfigPath = join(appRoot, 'tsconfig.app.json')
  if (!fileExists(tsconfigPath)) {
    return
  }
  const tsconfig = readJson<{ compilerOptions?: Record<string, unknown> }>(tsconfigPath)
  const compilerOptions = tsconfig.compilerOptions ?? {}
  if (compilerOptions.outDir !== 'dist') {
    return
  }
  writeFileEnsured(
    tsconfigPath,
    toJson({
      ...tsconfig,
      compilerOptions: {
        ...compilerOptions,
        outDir:          'out-tsc/app',
        tsBuildInfoFile: 'out-tsc/app/tsconfig.app.tsbuildinfo',
      },
    }),
  )
}
