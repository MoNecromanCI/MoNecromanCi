import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runNx } from '../nx-workspace'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { angularAppEmptyFiles, angularAppExampleFiles } from './angular-app-example.algorithm'
import {
  addProjectJsonTargets,
  ensureAdmZip,
  ensurePlugin,
  registerProjectCommands,
  removeGeneratedEslintConfig,
  type WorkspaceStack,
} from './post-generation.use-case'

/**
 * The compiler options an Angular app must override, because the workspace's base configuration is built for TypeScript
 * project references.
 *
 * @remarks
 * The base `tsconfig` is `composite` with `emitDeclarationOnly`, which the Angular compiler rejects (`NG4006`, `TS5069`;
 * Angular does not support project references, angular/angular#37276), and its `lib` has no `dom`. An application emits
 * through its bundler, never declarations, so the overrides cost nothing. Measured on Nx 23.2 with Angular 22.
 */
export const ANGULAR_APP_COMPILER_OPTIONS = {
  composite:           false,
  declaration:         false,
  declarationMap:      false,
  emitDeclarationOnly: false,
  lib:                 ['es2022', 'dom'],
} as const

/**
 * The `package` target of an Angular app: the browser bundle, zipped into `dist/drop`.
 *
 * @remarks
 * Angular's `application` builder writes the site into `<outputPath>/browser`, so that is what is zipped, as
 * `dist/drop/angular-app-<name>.zip`, which the CI "tag per app" step turns into a build tag like every other app kind.
 *
 * @param name - The Angular app's project name.
 * @returns The Nx targets to merge into the app's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function angularAppTargets (name: string): Record<string, unknown> {
  return {
    package: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/angular-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('dist/apps/${name}/browser');z.writeZip('dist/drop/angular-app-${name}.zip')"`,
      },
    },
  }
}

/**
 * Adds an Angular app: `@nx/angular:app` (esbuild) made to live in this workspace's TypeScript setup.
 *
 * @remarks
 * Two things the generator does not do for a workspace like this one. It (and the plugin's init generator) refuses a
 * TypeScript setup with project references unless `NX_IGNORE_UNSUPPORTED_TS_SETUP` is set, which is set for the install and
 * the generator and restored; and the app's
 * own `tsconfig.json` has to switch the references' options off ({@link ANGULAR_APP_COMPILER_OPTIONS}), or the build
 * fails. Nx's welcome page is replaced by a small greeting, as for the other front ends.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param stack - The workspace's chosen linter/test runner.
 * @param empty - Scaffold a bare app: a root component and nothing else (`--empty`).
 * @returns Nothing.
 * @throws Error when the generator or a required install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addAngularApp (workspaceRoot: string, name: string, stack: WorkspaceStack, empty = false): void {
  const previous = process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP
  process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP = 'true'
  try {
    // The plugin's init generator makes the same check, so the install is inside the override too.
    ensurePlugin(workspaceRoot, '@nx/angular')
    runNx(
      [
        'g',
        '@nx/angular:app',
        `apps/${name}`,
        '--bundler=esbuild',
        `--unitTestRunner=${stack.testRunner === 'vitest' ? 'vitest-angular' : 'jest'}`,
        '--linter=none',
        '--e2eTestRunner=none',
        '--formatter=none',
        '--style=css',
        '--no-interactive',
      ],
      workspaceRoot,
    )
  } finally {
    if (previous === undefined) {
      delete process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP
    } else {
      process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP = previous
    }
  }
  const appRoot = join(workspaceRoot, 'apps', name)
  // The generator writes a `project.json` and no manifest. A manifest is where the app's own `@angular/*` dependencies
  // belong (a runtime dependency at the root is a defect `mnci doctor` fails), and what `mnci add` moves them into.
  const manifestPath = join(appRoot, 'package.json')
  if (!fileExists(manifestPath)) {
    writeFileEnsured(manifestPath, toJson({ name, version: '0.0.0', private: true }))
  }
  overrideCompilerOptions(join(appRoot, 'tsconfig.json'), ANGULAR_APP_COMPILER_OPTIONS)
  // The spec project is checked on its own, and its Node 10 resolution is gone from TypeScript 6 and 7.
  overrideCompilerOptions(join(appRoot, 'tsconfig.spec.json'), {
    ...ANGULAR_APP_COMPILER_OPTIONS,
    module:           'preserve',
    moduleResolution: 'bundler',
  })
  // The app project writes to `outDir` from `src`, which TypeScript 6 wants a `rootDir` for.
  overrideCompilerOptions(join(appRoot, 'tsconfig.app.json'), { rootDir: 'src' })

  // Nx's welcome page is a demo, not a template.
  for (const generated of ['nx-welcome.ts', 'app.html', 'app.css', 'app.ts', 'app.spec.ts', 'app.routes.ts', 'app.config.ts']) {
    rmSync(join(appRoot, 'src/app', generated), { force: true })
  }
  moveTestSetupOutOfSrc(appRoot)
  const example = empty ? angularAppEmptyFiles() : angularAppExampleFiles(name)
  for (const [relative, contents] of Object.entries(example)) {
    writeFileEnsured(join(appRoot, 'src', relative), contents)
  }

  ensureAdmZip(workspaceRoot)
  addProjectJsonTargets(join(appRoot, 'project.json'), { ...angularAppTargets(name), typecheck: angularAppTypecheckTarget(name) })
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, {
    build:    true,
    start:    `nx run ${name}:serve`,
    buildDev: `nx run ${name}:build:development`,
    dev:      `nx run ${name}:serve`,
  })
}

/**
 * Moves the generator's `src/test-setup.ts` next to `jest.config`, outside `src`.
 *
 * @remarks
 * The slice rules allow only `index` and `main` at the root of `src`, and the file has no role. It is the runner's
 * own setup, which its config names by path, so it moves out of `src` and the three files that name it follow.
 *
 * @param appRoot - Absolute path to the app.
 * @returns Nothing.
 * @throws Propagates any `fs` error.
 * @typeParam None - this function has no generic type parameters.
 */
function moveTestSetupOutOfSrc (appRoot: string): void {
  const setup = join(appRoot, 'src/test-setup.ts')
  if (!fileExists(setup)) {
    return
  }
  writeFileEnsured(join(appRoot, 'test-setup.ts'), readFileSync(setup, 'utf8'))
  rmSync(setup)
  for (const file of ['jest.config.cts', 'tsconfig.spec.json', 'tsconfig.app.json']) {
    const path = join(appRoot, file)
    if (fileExists(path)) {
      writeFileEnsured(path, readFileSync(path, 'utf8').replaceAll('src/test-setup.ts', 'test-setup.ts'))
    }
  }
}

/**
 * Merges compiler options into a tsconfig, when the file exists.
 *
 * @param path - Absolute path to the tsconfig.
 * @param options - The options to set over what it has.
 * @returns Nothing.
 * @throws Propagates any `fs` or JSON error.
 * @typeParam None - this function has no generic type parameters.
 */
function overrideCompilerOptions (path: string, options: Record<string, unknown>): void {
  if (!fileExists(path)) {
    return
  }
  const tsconfig = readJson<{ compilerOptions?: Record<string, unknown> }>(path)
  tsconfig.compilerOptions = { ...tsconfig.compilerOptions, ...options }
  writeFileEnsured(path, toJson(tsconfig))
}

/**
 * The `typecheck` target of an Angular app: `tsc --noEmit` over the app's and the specs' tsconfig.
 *
 * @remarks
 * Replaces the one `@nx/js` infers, which runs `tsc --build --emitDeclarationOnly` and so fails on an app that is not
 * `composite`. This checks the TypeScript only: component templates are checked by the build (`strictTemplates`).
 *
 * @param name - The Angular app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function angularAppTypecheckTarget (name: string): Record<string, unknown> {
  return {
    executor: 'nx:run-commands',
    options:  {
      commands: ['tsc --noEmit -p tsconfig.app.json', 'tsc --noEmit -p tsconfig.spec.json'],
      parallel: false,
      cwd:      `apps/${name}`,
    },
  }
}
