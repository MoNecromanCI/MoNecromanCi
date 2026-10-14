import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { runNpx, runShell } from '../nx-workspace'
import { readJson, toJson, writeFileEnsured } from '../file-system'
import { svelteAppEmptyFiles, svelteAppExampleFiles, svelteViteConfig } from './svelte-app-example.algorithm'
import { SVELTE_PREVIEW_PORT, svelteAppE2eSpec, svelteE2eProjectFiles } from './svelte-e2e-project.algorithm'
import { finishPlaywrightProject } from './finish-playwright-project.use-case'
import {
  addNxTargets,
  ensureAdmZip,
  ensurePlugin,
  registerAppsWorkspace,
  registerProjectCommands,
  removeGeneratedEslintConfig,
} from './post-generation.use-case'

/**
 * The `create-vite` release a Svelte app is scaffolded with.
 *
 * @remarks
 * No Nx plugin for Svelte installs on this workspace (`@nxext/svelte` peers on TypeScript 5 and fails to resolve, measured),
 * so the app is made by Vite's own `svelte-ts` template, as Go and C# are made by their own tools. Pinned so a template
 * change is a deliberate bump, not whatever `latest` is on the day.
 */
export const CREATE_VITE_VERSION = '9.2.1'

/**
 * The development dependencies a Svelte app gets for its tests, beside what the template brings.
 *
 * @remarks
 * Left in the app's own manifest, not the root: they are what its code is tested with, and the per-project dependency
 * philosophy puts them where they are used.
 */
export const SVELTE_TEST_DEPENDENCIES = ['vitest', 'jsdom', '@testing-library/svelte'] as const

/**
 * The Nx targets of a Svelte app.
 *
 * @remarks
 * Written explicitly, as for Go and C#, because nothing infers them: `typecheck` is `svelte-check`, which reads `.svelte`
 * files (the inferred TypeScript one would build declarations from a configuration that has none), `test` is Vitest, and
 * `package` zips what Vite built. `build` and `dev` come from the template's own scripts.
 *
 * @param name - The Svelte app's project name.
 * @returns The Nx targets to merge into the app manifest's `nx` field.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function svelteAppTargets (name: string): Record<string, unknown> {
  const cwd = `apps/${name}`

  return {
    build:     { executor: 'nx:run-commands', outputs: [`{workspaceRoot}/apps/${name}/dist`], options: { command: 'vite build', cwd } },
    serve:     { executor: 'nx:run-commands', continuous: true, options: { command: 'vite', cwd } },
    test:      { executor: 'nx:run-commands', options: { command: 'vitest run', cwd } },
    typecheck: { executor: 'nx:run-commands', options: { command: 'svelte-check --tsconfig ./tsconfig.app.json && tsc -p tsconfig.node.json', cwd } },
    package:   {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/svelte-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('apps/${name}/dist');z.writeZip('dist/drop/svelte-app-${name}.zip')"`,
      },
    },
  }
}

/**
 * Adds a Svelte app: Vite's `svelte-ts` template, wired into Nx, with Vitest and a worked greeting example.
 *
 * @remarks
 * The template is scaffolded by `create-vite` ({@link CREATE_VITE_VERSION}), then reshaped: its counter sample and assets
 * go, the manifest loses its own copy of `typescript` (the workspace has the compiler) and gains the test tooling, and the
 * Nx targets are written explicitly ({@link svelteAppTargets}).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param empty - Scaffold a bare app: a root component and nothing else (`--empty`).
 * @param e2e - Also write the paired Playwright project, `<name>-e2e` (`--e2e`), which no Nx generator writes for Svelte.
 * @returns Nothing.
 * @throws Error when `create-vite` or an install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addSvelteApp (workspaceRoot: string, name: string, empty = false, e2e = false): void {
  runNpx([`create-vite@${CREATE_VITE_VERSION}`, `apps/${name}`, '--template', 'svelte-ts', '--no-interactive'], workspaceRoot)
  const appRoot = join(workspaceRoot, 'apps', name)
  // The template's sample, assets and editor folder are a demo; the README is the template's, not this project's.
  for (const generated of ['src/lib', 'src/assets', 'src/App.svelte', 'src/app.css', '.vscode', 'README.md', '.gitignore']) {
    rmSync(join(appRoot, generated), { recursive: true, force: true })
  }
  const example = empty ? svelteAppEmptyFiles() : svelteAppExampleFiles(name)
  for (const [relative, contents] of Object.entries(example)) {
    writeFileEnsured(join(appRoot, 'src', relative), contents)
  }
  writeFileEnsured(join(appRoot, 'vite.config.ts'), svelteViteConfig())

  const manifestPath = join(appRoot, 'package.json')
  const manifest = readJson<{ devDependencies?: Record<string, string> } & Record<string, unknown>>(manifestPath)
  // The compiler is the workspace's; a second copy per app is what the root `typescript` entry exists to avoid.
  const { typescript: _compiler, ...devDependencies } = manifest.devDependencies ?? {}
  writeFileEnsured(manifestPath, toJson({ ...manifest, devDependencies }))
  addNxTargets(manifestPath, svelteAppTargets(name))

  registerAppsWorkspace(workspaceRoot)
  // A plain install first, so npm knows the new workspace: the first `-w apps/<name>` after the folder appears is
  // otherwise a no-op that prints "no workspace folder present" and exits 0 (measured on npm 12).
  if (runShell('npm', ['install'], workspaceRoot) !== 0) {
    throw new Error('npm install failed after scaffolding the Svelte app')
  }
  if (runShell('npm', ['install', '--save-dev', '-w', `apps/${name}`, ...SVELTE_TEST_DEPENDENCIES], workspaceRoot) !== 0) {
    throw new Error(`npm install of ${SVELTE_TEST_DEPENDENCIES.join(', ')} into ${name} failed`)
  }
  ensureAdmZip(workspaceRoot)
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, {
    build:    true,
    start:    `nx run ${name}:serve`,
    buildDev: `nx run ${name}:build -- --mode development --sourcemap`,
    dev:      `nx run ${name}:serve`,
  })
  if (e2e) {
    addPairedPlaywrightProject(workspaceRoot, name, empty)
  }
}

/**
 * Writes the Playwright project paired with a Svelte app, and what it needs to run.
 *
 * @remarks
 * Nx's own generators write this project for React, Angular and Vue; Svelte has none, so the files come from
 * {@link svelteE2eProjectFiles}. `@nx/playwright` is installed (it brings `@playwright/test` and registers the plugin that
 * infers the `e2e` target), and the app gains a `preview` target that builds and then serves the bundle on
 * {@link SVELTE_PREVIEW_PORT}, which is what the project's web server starts. The rest is the step the other kinds share.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The Svelte app's project name.
 * @param empty - Whether the app is the bare variant.
 * @returns Nothing.
 * @throws Error when installing the Playwright plugin fails.
 * @typeParam None - this function has no generic type parameters.
 */
function addPairedPlaywrightProject (workspaceRoot: string, name: string, empty: boolean): void {
  ensurePlugin(workspaceRoot, '@nx/playwright')
  addNxTargets(join(workspaceRoot, 'apps', name, 'package.json'), {
    preview: {
      executor:   'nx:run-commands',
      continuous: true,
      dependsOn:  ['build'],
      options:    { command: `vite preview --port ${SVELTE_PREVIEW_PORT} --strictPort`, cwd: `apps/${name}` },
    },
  })
  const e2eRoot = join(workspaceRoot, 'apps', `${name}-e2e`)
  const files = Object.entries(svelteE2eProjectFiles(name))
  for (const [relative, contents] of files) {
    writeFileEnsured(join(e2eRoot, relative), contents)
  }
  finishPlaywrightProject(workspaceRoot, name, svelteAppE2eSpec(name, empty))
}
