import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runNx } from '../nx-workspace'
import { writeFileEnsured } from '../file-system'
import { nativeSliceCheckTarget, SLICE_CHECK_PATH, SLICE_CHECK_SCRIPT } from '../native-slice-check'
import { rustEmptyFiles, rustExampleFiles } from './rust-example.algorithm'
import { wireRustLibRelease } from './rust-release.use-case'
import {
  addProjectJsonTargets,
  ensureAdmZip,
  ensurePlugin,
  registerProjectCommands,
} from './post-generation.use-case'

/**
 * The Rust project kinds.
 *
 * @remarks
 * They differ in where they live and whether they are executables.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type RustKind = 'rust-app' | 'rust-lib' | 'rust-internal-lib'

/**
 * The Nx plugin the Rust kinds delegate to.
 *
 * @remarks
 * `@monodon/rust` 3 was measured on Nx 23.2 with Rust 1.76: `init`, `binary` and `library` generate, and `build`, `test` and
 * `lint` (clippy) pass. It declares `@nx/devkit ^22`, as `@nx-go/nx-go` declares `< 23` and was validated anyway.
 */
export const RUST_PLUGIN = '@monodon/rust'

/** Where each kind's crate lives: apps under `apps/`, publishable libraries under `packages/`, private ones under `libs/`. */
const RUST_DIRECTORIES: Readonly<Record<RustKind, string>> = {
  'rust-app':          'apps',
  'rust-lib':          'packages',
  'rust-internal-lib': 'libs',
}

/**
 * The targets mnci writes over the plugin's, because they need more than it gives.
 *
 * @remarks
 * - `lint` is `cargo fmt --check` and then clippy with every warning an error: the plugin's own `lint` runs clippy only,
 *   so formatting would never be checked (ESLint is the formatter for TypeScript; `rustfmt` is Rust's own).
 * - `typecheck` is `cargo check`, which the plugin has an executor for but no target.
 * - `package` (apps only) builds the release binary and zips it, as Go's `package` does.
 *
 * Every command passes the project's own `--target-dir` (the plugin's choice, `dist/target/<name>`): Nx clears a target's
 * outputs when it restores them from cache, so a directory shared by every crate would delete another crate's artifacts.
 *
 * @param name - The project name.
 * @param app - Whether the project is an executable.
 * @param directory - The crate's workspace-relative directory, which the slice check reads.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function rustTargets (name: string, app: boolean, directory: string): Record<string, unknown> {
  const targetDir = `dist/target/${name}`
  const targets: Record<string, unknown> = {
    'slice-check': nativeSliceCheckTarget('rust', directory),
    'lint':        {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['slice-check'],
      options:   {
        commands: [`cargo fmt -p ${name} --check`, `cargo clippy -p ${name} --all-targets --target-dir ${targetDir} -- -D warnings`],
        parallel: false,
      },
    },
    'typecheck': {
      cache:    true,
      executor: 'nx:run-commands',
      options:  { command: `cargo check -p ${name} --all-targets --target-dir ${targetDir}` },
    },
  }
  if (app) {
    const zip = [
      "const fs=require('node:fs');const p=require('node:path');",
      "fs.mkdirSync('dist/drop',{recursive:true});",
      "const A=require('adm-zip');const z=new A();",
      `const exe=['${name}.exe','${name}'].map(f=>p.join('${targetDir}/release',f)).find(f=>fs.existsSync(f));`,
      "if(!exe)throw new Error('no release binary was built');",
      `z.addLocalFile(exe);z.writeZip('dist/drop/rust-app-${name}.zip')`,
    ].join('')
    targets.package = {
      executor: 'nx:run-commands',
      outputs:  [`{workspaceRoot}/dist/drop/rust-app-${name}.zip`],
      options:  {
        commands: [`cargo build --release -p ${name} --target-dir ${targetDir}`, `node -e "${zip}"`],
        parallel: false,
      },
    }
  }

  return targets
}

/**
 * Runs a step with `nx.json`'s `workspaceLayout` pointing at one folder, then puts the file back exactly as it was.
 *
 * @remarks
 * `@monodon/rust` places a crate by `getWorkspaceLayout`: `appsDir`/`libsDir` from `nx.json`, or, when they are not set,
 * whichever of `apps`, `libs` and `packages` happens to exist. mnci workspaces have `packages/` from the start, so a
 * crate asked for `--directory=apps` landed in `packages/apps/<name>` (measured). Setting both to the wanted folder for
 * the one call makes the root deterministic: `<folder>/<name>`, and the project is named `<name>` with no prefix.
 * The generator's `--directory` is not used at all.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param folder - The folder the crate goes under (`apps`, `libs` or `packages`).
 * @param step - What to run with the layout set.
 * @returns Nothing.
 * @throws Whatever `step` throws; `nx.json` is restored first.
 * @typeParam None - this function has no generic type parameters.
 */
function withWorkspaceLayout (workspaceRoot: string, folder: string, step: () => void): void {
  const path = join(workspaceRoot, 'nx.json')
  const original = readFileSync(path, 'utf8')
  const parsed = JSON.parse(original) as Record<string, unknown>
  const withLayout = { ...parsed, workspaceLayout: { appsDir: folder, libsDir: folder } }
  writeFileSync(path, JSON.stringify(withLayout, undefined, 2) + '\n')
  try {
    step()
  } finally {
    writeFileSync(path, original)
  }
}

/**
 * Adds a Rust project: `@monodon/rust`'s binary or library generator, renamed, reshaped into a slice and given the targets
 * the plugin lacks.
 *
 * @remarks
 * The plugin snake_cases the name (`my-tool` becomes `my_tool`), which is Rust's own convention for a crate and its folder.
 *
 * The crate's dependencies are its own: a `[dependencies]` table in its `Cargo.toml`, with one root `Cargo.lock` for the
 * Cargo workspace the plugin's `init` writes. A library under `libs/` is private (`rust-internal-lib`), one under
 * `packages/` is the publishable one (`rust-lib`), released by `nx release` with a version read from `Cargo.toml` and published
 * to crates.io when `CARGO_REGISTRY_TOKEN` is set.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param kind - Which Rust kind.
 * @param empty - Scaffold a bare project (`--empty`).
 * @returns Nothing.
 * @throws Error when the plugin install or the generator fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addRustProject (workspaceRoot: string, name: string, kind: RustKind, empty = false): void {
  const app = kind === 'rust-app'
  const directory = RUST_DIRECTORIES[kind]
  ensurePlugin(workspaceRoot, RUST_PLUGIN)
  ensureAdmZip(workspaceRoot)
  withWorkspaceLayout(workspaceRoot, directory, () => {
    runNx(
      ['g', `${RUST_PLUGIN}:${app ? 'binary' : 'library'}`, `--name=${name}`, `--tags=type:${kind}`, '--no-interactive'],
      workspaceRoot,
    )
  })
  const projectRoot = join(workspaceRoot, directory, name)

  const files = empty ? rustEmptyFiles(app ? 'app' : 'lib') : rustExampleFiles(app ? 'app' : 'lib', name)
  for (const [relative, contents] of Object.entries(files)) {
    writeFileEnsured(join(projectRoot, 'src', relative), contents)
  }
  writeFileEnsured(join(workspaceRoot, SLICE_CHECK_PATH), SLICE_CHECK_SCRIPT)
  addProjectJsonTargets(join(projectRoot, 'project.json'), rustTargets(name, app, `${directory}/${name}`))
  if (kind === 'rust-lib') {
    wireRustLibRelease(workspaceRoot, `${directory}/${name}`, name)
  }
  registerProjectCommands(workspaceRoot, name, app ? { build: true, start: `nx run ${name}:run` } : { build: true })
}
