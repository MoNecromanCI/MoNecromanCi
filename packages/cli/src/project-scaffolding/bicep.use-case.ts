import { join } from 'node:path'
import { fileExists, toJson, writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import { bicepConfig, bicepEmptyFiles, bicepExampleFiles } from './bicep-example.algorithm'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/**
 * The Nx targets of a Bicep project.
 *
 * @remarks
 * Written explicitly, as for Go and C#, because no plugin infers them. Everything goes through `az bicep`, which
 * downloads the Bicep CLI on first use, so the project needs the Azure CLI and nothing else:
 *
 * - `lint` is `az bicep lint` (its errors fail; `bicepconfig.json` promotes the rules that catch real mistakes),
 * - `build` compiles `main.bicep` to `main.json` and `main.bicepparam` to `main.parameters.json` in
 *   `dist/apps/<name>`,
 * - `package` zips that folder into `dist/drop/bicep-<name>.zip`, which is what a deployment pipeline takes.
 *
 * There is no `test` target: Bicep has no unit test runner, and `build` already fails on a template that does not
 * compile. `what-if` against a real subscription is a deployment concern, not a verify-phase one.
 *
 * @param name - The Bicep project's name.
 * @returns The Nx targets for its `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function bicepTargets (name: string): Record<string, unknown> {
  const cwd = `apps/${name}`
  const out = `dist/apps/${name}`

  return {
    lint:  { executor: 'nx:run-commands', options: { command: 'az bicep lint --file main.bicep', cwd } },
    build: {
      executor: 'nx:run-commands',
      outputs:  [`{workspaceRoot}/${out}`],
      options:  {
        commands: [
          `az bicep build --file main.bicep --outdir ../../${out}`,
          `az bicep build-params --file main.bicepparam --outfile ../../${out}/main.parameters.json`,
        ],
        parallel: false,
        cwd,
      },
    },
    package: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/bicep-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('${out}');z.writeZip('dist/drop/bicep-${name}.zip')"`,
      },
    },
  }
}

/**
 * Adds a Bicep infrastructure project under `apps/`.
 *
 * @remarks
 * There is no generator to delegate to (`@nx/*` has none for Bicep), so the files are written directly: `main.bicep`, a
 * `main.bicepparam` that uses it, a `bicepconfig.json` that makes the linter's rules errors, and a `project.json`.
 * `--empty` writes a template that declares nothing. Measured with Bicep CLI 0.48 through the Azure CLI: `lint`,
 * `build` and `build-params` pass on the example. Terraform is not covered.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param empty - Scaffold a template with no resources (`--empty`).
 * @returns Nothing.
 * @throws Error when the project directory already exists.
 * @typeParam None - this function has no generic type parameters.
 */
export function addBicepProject (workspaceRoot: string, name: string, empty = false): void {
  const root = join(workspaceRoot, 'apps', name)
  if (fileExists(root)) {
    throw new Error(`apps/${name} already exists.`)
  }
  const files = empty ? bicepEmptyFiles() : bicepExampleFiles()
  for (const [relative, contents] of Object.entries(files)) {
    writeFileEnsured(join(root, relative), contents)
  }
  writeFileEnsured(join(root, 'bicepconfig.json'), bicepConfig())
  writeFileEnsured(join(root, 'project.json'), toJson({
    name,
    $schema:     '../../node_modules/nx/schemas/project-schema.json',
    projectType: 'application',
    sourceRoot:  `apps/${name}`,
    tags:        ['type:bicep-iac'],
    targets:     {},
  }))
  addProjectJsonTargets(join(root, 'project.json'), bicepTargets(name))
  ensureAdmZip(workspaceRoot)
  registerProjectCommands(workspaceRoot, name, {
    build: true,
    qa:    `nx run ${name}:lint && nx run ${name}:build`,
  })
  logger.info('Bicep is compiled by `az bicep`, which downloads the Bicep CLI on first use: the Azure CLI is the one prerequisite.')
}
