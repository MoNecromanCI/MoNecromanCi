import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { runNpx, runShell } from '../nx-workspace'
import { readJson, toJson, writeFileEnsured } from '../file-system'
import { htmlAppEmptyFiles, htmlAppExampleFiles, htmlAppIndexPage, htmlViteConfig } from './html-app-example.algorithm'
import { CREATE_VITE_VERSION } from './svelte-app.use-case'
import {
  addNxTargets,
  ensureAdmZip,
  registerAppsWorkspace,
  registerProjectCommands,
  removeGeneratedEslintConfig,
} from './post-generation.use-case'

/**
 * The runtime packages an `html-app` has: jQuery, in the app's own manifest.
 *
 * @remarks
 * From npm and not a `<script>` tag from a CDN, so the lockfile pins it, `mnci up` and `mnci doctor` see it, and the
 * bundle carries it. It is a runtime dependency of this project and so is never installed at the root.
 */
export const HTML_APP_DEPENDENCIES = ['jquery'] as const

/**
 * The development packages an `html-app` has: its types and what its specs run with.
 *
 * @remarks
 * Left in the app's own manifest, as for `svelte-app`. The compiler is the workspace's and is not repeated.
 */
export const HTML_APP_DEV_DEPENDENCIES = ['@types/jquery', 'vitest', 'jsdom'] as const

/**
 * The Nx targets of an `html-app`.
 *
 * @remarks
 * Written explicitly, as for Svelte and Go, because nothing infers them from a plain Vite project: `typecheck` is
 * `tsc --noEmit`, `test` is Vitest (which passes with no tests, for `--empty`) and `package` zips what Vite built.
 *
 * @param name - The app's project name.
 * @returns The Nx targets to merge into the app manifest's `nx` field.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function htmlAppTargets (name: string): Record<string, unknown> {
  const cwd = `apps/${name}`

  return {
    build:     { executor: 'nx:run-commands', outputs: [`{workspaceRoot}/apps/${name}/dist`], options: { command: 'vite build', cwd } },
    serve:     { executor: 'nx:run-commands', continuous: true, options: { command: 'vite', cwd } },
    test:      { executor: 'nx:run-commands', options: { command: 'vitest run --passWithNoTests', cwd } },
    typecheck: { executor: 'nx:run-commands', options: { command: 'tsc --noEmit', cwd } },
    package:   {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/html-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('apps/${name}/dist');z.writeZip('dist/drop/html-app-${name}.zip')"`,
      },
    },
  }
}

/**
 * Adds an `html-app`: a web app of plain HTML, CSS and jQuery, built and served by Vite, with Vitest and a worked example.
 *
 * @remarks
 * No Nx generator is the right base (`@nx/web` is deprecated, and the framework generators bring the framework this
 * kind leaves out), so the app is Vite's own `vanilla-ts` template, made by the pinned `create-vite`
 * ({@link CREATE_VITE_VERSION}) and wired as `svelte-app` is: explicit `nx.targets`, `apps/*` registered as a
 * workspace, and a plain install before the per-app one. jQuery is installed into the app's manifest.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param empty - Scaffold a bare app: an empty `main` and no feature (`--empty`).
 * @returns Nothing.
 * @throws Error when `create-vite` or an install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addHtmlApp (workspaceRoot: string, name: string, empty = false): void {
  runNpx([`create-vite@${CREATE_VITE_VERSION}`, `apps/${name}`, '--template', 'vanilla-ts', '--no-interactive'], workspaceRoot)
  const appRoot = join(workspaceRoot, 'apps', name)
  // The template's counter sample, its logo and its editor folder are a demo; the page is rewritten below.
  for (const generated of ['src/counter.ts', 'src/main.ts', 'src/style.css', 'src/typescript.svg', 'public', '.vscode', 'README.md', '.gitignore']) {
    rmSync(join(appRoot, generated), { recursive: true, force: true })
  }
  writeFileEnsured(join(appRoot, 'index.html'), htmlAppIndexPage(name, empty))
  const example = empty ? htmlAppEmptyFiles() : htmlAppExampleFiles()
  for (const [relative, contents] of Object.entries(example)) {
    writeFileEnsured(join(appRoot, 'src', relative), contents)
  }
  writeFileEnsured(join(appRoot, 'vite.config.ts'), htmlViteConfig())

  const manifestPath = join(appRoot, 'package.json')
  const manifest = readJson<{ devDependencies?: Record<string, string> } & Record<string, unknown>>(manifestPath)
  // The compiler is the workspace's; a second copy per app is what the root `typescript` entry exists to avoid.
  const { typescript: _compiler, ...devDependencies } = manifest.devDependencies ?? {}
  writeFileEnsured(manifestPath, toJson({ ...manifest, devDependencies }))
  addNxTargets(manifestPath, htmlAppTargets(name))

  registerAppsWorkspace(workspaceRoot)
  // A plain install first, so npm knows the new workspace: the first `-w apps/<name>` after the folder appears is
  // otherwise a no-op that prints "no workspace folder present" and exits 0 (measured on npm 12).
  if (runShell('npm', ['install'], workspaceRoot) !== 0) {
    throw new Error('npm install failed after scaffolding the HTML app')
  }
  if (runShell('npm', ['install', '-w', `apps/${name}`, ...HTML_APP_DEPENDENCIES], workspaceRoot) !== 0) {
    throw new Error(`npm install of ${HTML_APP_DEPENDENCIES.join(', ')} into ${name} failed`)
  }
  if (runShell('npm', ['install', '--save-dev', '-w', `apps/${name}`, ...HTML_APP_DEV_DEPENDENCIES], workspaceRoot) !== 0) {
    throw new Error(`npm install of ${HTML_APP_DEV_DEPENDENCIES.join(', ')} into ${name} failed`)
  }
  ensureAdmZip(workspaceRoot)
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, {
    build:    true,
    start:    `nx run ${name}:serve`,
    buildDev: `nx run ${name}:build -- --mode development --sourcemap`,
    dev:      `nx run ${name}:serve`,
  })
}
