import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { runNpx, runShell } from '../nx-workspace'
import { readJson, toJson, writeFileEnsured } from '../file-system'
import { docsSiteAstroConfig, docsSitePages } from './docs-site-example.algorithm'
import {
  addNxTargets,
  ensureAdmZip,
  registerAppsWorkspace,
  registerProjectCommands,
  removeGeneratedEslintConfig,
} from './post-generation.use-case'

/**
 * The `create-astro` release a docs site is scaffolded with.
 *
 * @remarks
 * Pinned so a template change is a deliberate bump, as for `create-vite` in the Svelte kind. The template is Starlight's
 * own (`--template starlight`).
 */
export const CREATE_ASTRO_VERSION = '5.2.6'

/**
 * The Nx targets of a docs site.
 *
 * @remarks
 * Written explicitly, as for Go and C#, because nothing infers them: `build` and `serve` are Astro's, `typecheck` is
 * `astro check` (content collections and `.astro` files), and `package` zips the built site. There is no `test` target: a
 * docs site has none, and `build` already fails on a broken link in the sidebar or a page that breaks its schema.
 *
 * `build` depends on `typecheck`, which is the order Astro's own documentation gives (`astro check && astro build`) and
 * also a requirement: both sync the content collections into `.astro/`, so run together (as `nx run-many` does) they race
 * and one dies with `ENOENT` renaming a temporary file (measured).
 *
 * @param name - The docs site's project name.
 * @returns The Nx targets to merge into the app manifest's `nx` field.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function docsSiteTargets (name: string): Record<string, unknown> {
  const cwd = `apps/${name}`

  return {
    build:     { executor: 'nx:run-commands', dependsOn: ['typecheck'], outputs: [`{workspaceRoot}/apps/${name}/dist`], options: { command: 'astro build', cwd } },
    serve:     { executor: 'nx:run-commands', continuous: true, options: { command: 'astro dev', cwd } },
    typecheck: { executor: 'nx:run-commands', options: { command: 'astro check', cwd } },
    package:   {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/docs-site-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('apps/${name}/dist');z.writeZip('dist/drop/docs-site-${name}.zip')"`,
      },
    },
  }
}

/**
 * Adds a docs site: Astro's Starlight template, wired into Nx.
 *
 * @remarks
 * No Nx plugin exists for Astro, so the site is made by `create-astro` ({@link CREATE_ASTRO_VERSION}) and reshaped: the
 * template's files that are about the template (its `CLAUDE.md` and `AGENTS.md`, README, editor folder, mascot image) go,
 * the manifest is renamed to the project, the config and pages are replaced by ones that name this project, and the Nx
 * targets are written explicitly ({@link docsSiteTargets}). `@astrojs/check` is a development dependency of the site.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @returns Nothing.
 * @throws Error when `create-astro` or an install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addDocsSite (workspaceRoot: string, name: string): void {
  runNpx(
    [`create-astro@${CREATE_ASTRO_VERSION}`, `apps/${name}`, '--template', 'starlight', '--no-install', '--no-git', '--yes', '--skip-houston'],
    workspaceRoot,
  )
  const siteRoot = join(workspaceRoot, 'apps', name)
  // The template's own documentation, assistant files and demo content are about the template, not this project. Its
  // `.gitignore` stays: it is what keeps the generated `.astro/` types out of git.
  for (const generated of ['CLAUDE.md', 'AGENTS.md', 'README.md', '.vscode', 'src/assets', 'src/content/docs']) {
    rmSync(join(siteRoot, generated), { recursive: true, force: true })
  }
  const pages = Object.entries(docsSitePages(name))
  for (const [relative, contents] of pages) {
    writeFileEnsured(join(siteRoot, 'src/content/docs', relative), contents)
  }
  writeFileEnsured(join(siteRoot, 'astro.config.mjs'), docsSiteAstroConfig(name))

  const manifestPath = join(siteRoot, 'package.json')
  const manifest = readJson<Record<string, unknown>>(manifestPath)
  writeFileEnsured(manifestPath, toJson({ ...manifest, name, private: true }))
  addNxTargets(manifestPath, docsSiteTargets(name))

  registerAppsWorkspace(workspaceRoot)
  // A plain install first: the first `-w apps/<name>` after the folder appears is otherwise a silent no-op (npm 12).
  if (runShell('npm', ['install'], workspaceRoot) !== 0) {
    throw new Error('npm install failed after scaffolding the docs site')
  }
  if (runShell('npm', ['install', '--save-dev', '-w', `apps/${name}`, '@astrojs/check'], workspaceRoot) !== 0) {
    throw new Error(`npm install of @astrojs/check into ${name} failed`)
  }
  ensureAdmZip(workspaceRoot)
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, {
    build: true,
    start: `nx run ${name}:serve`,
    dev:   `nx run ${name}:serve`,
    qa:    `nx run ${name}:lint && nx run ${name}:typecheck && nx run ${name}:build`,
  })
}
