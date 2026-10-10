import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runNx, runShell } from '../nx-workspace'
import { writeFileEnsured } from '../file-system'
import { separateReactAppOutput } from '../react-app-output'
import { vueAppEmptyFiles, vueAppExampleFiles } from './vue-app-example.algorithm'
import {
  addNxTargets,
  ensureAdmZip,
  ensurePlugin,
  registerProjectCommands,
  removeGeneratedEslintConfig,
} from './post-generation.use-case'

/**
 * The `vue-tsc` range a Vue app is type-checked with.
 *
 * @remarks
 * `@nx/vue` installs `vue-tsc` 2, which patches TypeScript's `lib/tsc.js` and cannot read the one TypeScript 6 ships
 * ("Failed to locate tsc module path from shim", measured). Version 3 can. It is a root development tool, like the
 * compilers.
 */
export const VUE_TSC_RANGE = '^3'

/**
 * The `package` target of a Vue app: the Vite bundle, zipped into `dist/drop`.
 *
 * @remarks
 * Vite writes the site into `apps/<name>/dist`, which is zipped as `dist/drop/vue-app-<name>.zip`, which the CI "tag per
 * app" step turns into a build tag like every other app kind.
 *
 * @param name - The Vue app's project name.
 * @returns The Nx targets to merge into the app manifest's `nx` field.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function vueAppTargets (name: string): Record<string, unknown> {
  return {
    package: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/vue-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('apps/${name}/dist');z.writeZip('dist/drop/vue-app-${name}.zip')"`,
      },
    },
  }
}

/**
 * Adds a Vue app: `@nx/vue:app` (Vite, Vitest) with a worked greeting example and a zip target.
 *
 * @remarks
 * Vue's generator accepts this workspace's TypeScript setup as it is, unlike Angular's. What it does not do: it installs
 * `vue-tsc` 2, which cannot read TypeScript 6 ({@link VUE_TSC_RANGE}); its welcome page is a demo; and Vitest is the only
 * unit test runner it supports, whatever the workspace's own is.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param empty - Scaffold a bare app: a root component and nothing else (`--empty`).
 * @returns Nothing.
 * @throws Error when the generator or a required install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addVueApp (workspaceRoot: string, name: string, empty = false): void {
  ensurePlugin(workspaceRoot, '@nx/vue')
  runNx(
    [
      'g',
      '@nx/vue:app',
      `apps/${name}`,
      '--name',
      name,
      '--bundler=vite',
      '--unitTestRunner=vitest',
      '--linter=none',
      '--e2eTestRunner=none',
      '--formatter=none',
      '--style=css',
      '--routing=false',
      '--no-interactive',
    ],
    workspaceRoot,
  )
  if (runShell('npm', ['install', '--save-dev', `vue-tsc@${VUE_TSC_RANGE}`], workspaceRoot) !== 0) {
    throw new Error(`npm install vue-tsc@${VUE_TSC_RANGE} failed`)
  }
  ensureAdmZip(workspaceRoot)
  const appRoot = join(workspaceRoot, 'apps', name)
  // Nx's welcome page is a demo, not a template, and `vue-tsc` reads `.vue` imports itself, so the shim is no use.
  for (const generated of ['src/app/NxWelcome.vue', 'src/app/App.vue', 'src/app/App.spec.ts', 'src/vue-shims.d.ts']) {
    rmSync(join(appRoot, generated), { force: true })
  }
  const example = empty ? vueAppEmptyFiles() : vueAppExampleFiles(name)
  for (const [relative, contents] of Object.entries(example)) {
    writeFileEnsured(join(appRoot, 'src', relative), contents)
  }
  // tsc's output is never used for an app, and it must not share a folder with the bundle Vite writes (#346); the check
  // is about a Vite config and a tsconfig, so it is the one React apps use.
  separateReactAppOutput(appRoot)
  // The entry imports the root component by the name it had; it is now named for its role.
  const entry = join(appRoot, 'src/main.ts')
  writeFileEnsured(entry, readFileSync(entry, 'utf8').replaceAll('./app/App.vue', './app/app.component.vue'))
  addNxTargets(join(appRoot, 'package.json'), vueAppTargets(name))
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, {
    build:    true,
    start:    `nx run ${name}:serve`,
    buildDev: `nx run ${name}:build --mode development --sourcemap`,
    dev:      `nx run ${name}:serve`,
  })
}
