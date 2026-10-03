import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runShell } from '../nx-workspace'
import { fileExists, readCodeWorkspace, readJson, toJson, writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import { VSCODE_EXTENSION_TAG } from '../workspace-overlay'
import { runNodeApp } from './node.use-case'
import {
  addNxTargets,
  hasPlugin,
  registerProjectCommands,
  removeGeneratedEslintConfig,
  type WorkspaceStack,
} from './post-generation.use-case'

/**
 * Where the packaging and publishing script lives in a generated workspace.
 *
 * @remarks
 * A workspace-relative file rather than a seventh mnci package, the same call as
 * `tools/csharp-version-actions.cjs`: the targets need real logic (a loop over the
 * Marketplace platforms, a staging copy of the sidecar, a publish gate), the
 * workspace has no mnci runtime dependency to put it in, and a one-liner holding
 * all of it would be unreadable. mnci owns it: `mnci add vscode-extension` writes
 * it and `mnci upgrade` rewrites it whenever an extension exists.
 */
export const VSCODE_EXTENSION_SCRIPT_PATH = 'tools/vscode-extension.cjs'

/**
 * The Marketplace targets a sidecar build packages, and the Go platform each takes its binary from.
 *
 * @remarks
 * The right-hand side is the directory a `go-app`'s `build-all` writes under
 * `dist/platforms/<app>/` (#226). Alpine reuses the Linux binaries: they are static
 * (`CGO_ENABLED=0`), so musl needs nothing of its own, and without an Alpine
 * package the Marketplace offers an Alpine user nothing at all, since a sidecar
 * build publishes no universal package to fall back on. `linux-armhf` and `web`
 * are left out: there is no Go build for the first, and a browser cannot run a
 * native binary.
 */
export const VSCODE_SIDECAR_TARGETS: Readonly<Record<string, string>> = {
  'win32-x64':    'windows-amd64',
  'win32-arm64':  'windows-arm64',
  'linux-x64':    'linux-amd64',
  'linux-arm64':  'linux-arm64',
  'alpine-x64':   'linux-amd64',
  'alpine-arm64': 'linux-arm64',
  'darwin-x64':   'darwin-amd64',
  'darwin-arm64': 'darwin-arm64',
}

/**
 * Renders a string map as an object literal in the house style.
 *
 * @remarks
 * The script is linted by the workspace it is written into (#249), and
 * `mnci upgrade` rewrites it without formatting, so it must be clean as written:
 * `JSON.stringify` would give double quotes and no spacing.
 *
 * @param map - The keys and values to render.
 * @returns A one-line object literal with single-quoted keys and values.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
function scriptObjectLiteral (map: Readonly<Record<string, string>>): string {
  return `{ ${Object.entries(map).map(([key, value]) => `'${key}': '${value}'`).join(', ')} }`
}

/**
 * The `tools/vscode-extension.cjs` script: `package` and `publish` for every extension.
 *
 * @remarks
 * - **No shell, no path into `node_modules`.** `vsce` and `nx` are resolved through
 *   their own `package.json` `bin` field and run with the current `node`, so a
 *   workspace path with a space in it works on Windows and an upgrade of either
 *   tool that moves its entry file changes nothing here.
 * - **`--no-dependencies`** is mandatory in npm workspaces: dependencies are hoisted
 *   to the root, so `vsce`'s own `npm list` walk fails, and the build is bundled
 *   anyway (`thirdParty: true`), so there is nothing to ship.
 * - **The sidecar is stamped with the extension's version.** `build-all` is run from
 *   here with `VERSION` set to the manifest's version rather than declared as a
 *   `dependsOn`, which cannot pass a different environment to one dependency. In a
 *   release that is the version `nx release` just wrote, so the engine and the
 *   extension it ships in always agree.
 * - **`publish` is gated on a credential**, the same pattern as the C# NuGet
 *   target: the target must exist even when nothing is configured, because Nx
 *   throws when no project in a release group carries `nx-release-publish`.
 *   `VSCE_AUTH=entra` (set by the GitHub release step when the `AZURE_CLIENT_ID`
 *   variable exists, after `azure/login`) publishes with `--azure-credential`:
 *   Microsoft Entra ID through OIDC, no stored secret (#253). It wins over
 *   `VSCE_PAT`, a Marketplace personal access token, which remains the fallback.
 *   Azure Pipelines leaves an undefined `$(VSCE_PAT)` macro as that literal text,
 *   so that reads as unset too. The signal is explicit rather than "is
 *   `AZURE_CLIENT_ID` set": `azure/login` exports no variable, and exporting
 *   `AZURE_CLIENT_ID` would steer `@azure/identity` towards a managed identity the
 *   runner does not have.
 * - **A `#!/usr/bin/env node` line**, though it is always run as `node <file>`:
 *   it is how `unicorn/no-process-exit` recognises a command-line program, the
 *   one place an exit code is the interface.
 * - **A dry run never publishes.** `nx release --dry-run --yes` still runs every
 *   `nx-release-publish` target, handing it `--dryRun=true` and `NX_DRY_RUN`
 *   (measured); the script prints what it would publish and stops, even with a
 *   token present.
 * - **`--skip-duplicate`** makes a re-run of a release that already reached the
 *   Marketplace a no-op rather than a failure, the role `--skip-existing` plays for
 *   twine.
 */
export const VSCODE_EXTENSION_SCRIPT = String.raw`#!/usr/bin/env node
// Written by mnci: 'mnci add vscode-extension' creates it and 'mnci upgrade'
// rewrites it, so local edits do not survive an upgrade.
//
// Packages and publishes a VS Code extension project. Its Nx targets call it:
//   node tools/vscode-extension.cjs package apps/<name> [--sidecar <go-app>]
//   node tools/vscode-extension.cjs publish apps/<name> [--sidecar <go-app>]
// Without --sidecar: one universal dist/drop/<project>.vsix.
// With --sidecar: one dist/drop/<project>-<target>.vsix per Marketplace target, each
// carrying that platform's binary from the Go app's build-all in bin/.
'use strict'
const { spawnSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { basename, dirname, join, resolve } = require('node:path')

const TARGETS = ${scriptObjectLiteral(VSCODE_SIDECAR_TARGETS)}
const DROP = resolve('dist/drop')
const VSCE_FLAGS = ['--no-dependencies', '--skip-license', '--allow-missing-repository']

function fail (message) {
  console.error(message)
  process.exit(1)
}

function bin (packageName, command) {
  const manifestPath = require.resolve(packageName + '/package.json', { paths: [process.cwd()] })
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[command]

  return join(dirname(manifestPath), entry)
}

function run (packageName, command, args, options) {
  const result = spawnSync(process.execPath, [bin(packageName, command), ...args], { stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function vsixFiles (name, sidecar) {
  return sidecar
    ? Object.keys(TARGETS).map(target => join(DROP, name + '-' + target + '.vsix'))
    : [join(DROP, name + '.vsix')]
}

function packageExtension (projectRoot, manifest, sidecar) {
  mkdirSync(DROP, { recursive: true })
  if (!sidecar) {
    run('@vscode/vsce', 'vsce', ['package', ...VSCE_FLAGS, '--out', vsixFiles(project)[0]], { cwd: projectRoot })

    return
  }
  run('nx', 'nx', ['run', sidecar + ':build-all'], { env: { ...process.env, VERSION: manifest.version } })
  const staging = join(projectRoot, 'bin')
  try {
    for (const [target, platform] of Object.entries(TARGETS)) {
      const source = join('dist/platforms', sidecar, platform)
      if (!existsSync(source)) fail('No ' + platform + ' build of ' + sidecar + ' at ' + source + ' - its build-all target did not write one.')
      rmSync(staging, { recursive: true, force: true })
      cpSync(source, staging, { recursive: true })
      run('@vscode/vsce', 'vsce', ['package', '--target', target, ...VSCE_FLAGS, '--out', join(DROP, project + '-' + target + '.vsix')], { cwd: projectRoot })
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function publishExtension (manifest, sidecar, dryRun) {
  if (dryRun) {
    console.log('Dry run - would publish ' + vsixFiles(project, sidecar).join(', ') + ' to the Marketplace.')

    return
  }
  const entra = process.env.VSCE_AUTH === 'entra'
  const token = process.env.VSCE_PAT ?? ''
  if (!entra && (token === '' || /^\$\(.*\)$/.test(token))) {
    console.log('No Marketplace credential - skipping the Marketplace publish of ' + manifest.name + '. Set the AZURE_CLIENT_ID and AZURE_TENANT_ID variables (Microsoft Entra ID) or the VSCE_PAT secret to publish.')

    return
  }
  const files = vsixFiles(project, sidecar)
  const missing = files.filter(file => !existsSync(file))
  if (missing.length > 0) fail('Nothing to publish: ' + missing.join(', ') + ' not found - run the package target first.')
  run('@vscode/vsce', 'vsce', ['publish', ...(entra ? ['--azure-credential'] : []), '--packagePath', ...files, '--skip-duplicate'])
}

const [command, projectRoot, ...rest] = process.argv.slice(2)
const sidecarIndex = rest.indexOf('--sidecar')
const sidecar = sidecarIndex === -1 ? undefined : rest[sidecarIndex + 1]
if (!projectRoot || !existsSync(join(projectRoot, 'package.json'))) fail('Usage: node tools/vscode-extension.cjs package|publish <project root> [--sidecar <go-app>]')
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
// Packages are named after the project folder, never the manifest name, which is
// free to change (the Marketplace id need not match the folder).
const project = basename(resolve(projectRoot))
// nx release --dry-run hands the publish target --dryRun=true and sets NX_DRY_RUN
// (measured on Nx 23), so a dry run never reaches the Marketplace, token or not.
const dryRun = rest.some(argument => /^--dry-?run(?:=true)?$/i.test(argument)) || process.env.NX_DRY_RUN === 'true'
if (command === 'package') packageExtension(projectRoot, manifest, sidecar)
else if (command === 'publish') publishExtension(manifest, sidecar, dryRun)
else fail('Unknown command ' + command + ' - expected package or publish.')
`

/**
 * The `.vscodeignore` written into every extension.
 *
 * @remarks
 * The build is bundled into `dist/main.js`, so everything else in the project
 * folder is source or tooling. `**\/*.d.ts` matters: declarations cannot be turned
 * off at build time (`declaration: false` collides with the workspace's
 * `composite`/`declarationMap` and dies on TS5069, measured), so they are dropped
 * here instead. `bin/` is deliberately NOT ignored: it is where a sidecar is staged.
 */
export const VSCODE_IGNORE = `src/**
test/**
out-tsc/**
test-output/**
**/*.map
**/*.d.ts
**/*.spec.*
tsconfig*.json
jest.config.*
vitest.config.*
.spec.swcrc
node_modules/**
`

/**
 * The sample entry point: `activate` registers one command.
 *
 * @remarks
 * `src/main.ts`, not VS Code's customary `extension.ts`: the slice rules allow only
 * `index` and `main` at the root of `src`. `activationEvents` stays empty because VS
 * Code (since 1.74) activates on the contributed command by itself.
 *
 * @param name - The project name, which prefixes the command id.
 * @returns The file content.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeExtensionMain (name: string): string {
  return `import * as vscode from 'vscode'

export function activate (context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('${name}.hello', () => {
      void vscode.window.showInformationMessage('Hello from ${name}')
    }),
  )
}

export function deactivate (): void {}
`
}

/**
 * The sample spec, which runs `activate` against the `vscode` stub.
 *
 * @remarks
 * Written against the real `vscode` types and runner-neutral (`describe`/`it`/
 * `expect` are globals under both Jest and Vitest here), so the same file serves
 * either stack and typechecks without knowing the stub exists.
 *
 * @param name - The project name, which prefixes the command id.
 * @returns The file content.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeExtensionMainSpec (name: string): string {
  return `import * as vscode from 'vscode'
import { activate } from './main'

describe('activate', () => {
  it('registers the ${name}.hello command', async () => {
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext

    activate(context)

    expect(context.subscriptions).toHaveLength(1)
    expect(await vscode.commands.getCommands()).toContain('${name}.hello')
  })
})
`
}

/**
 * Stands in for the `vscode` module in unit tests.
 *
 * @remarks
 * `vscode` exists only inside the extension host: it is injected at runtime and no
 * package by that name is ever installed (`@types/vscode` carries only types). So
 * a spec that imports anything importing it fails to resolve. The test runner maps
 * the specifier here instead (Jest `moduleNameMapper`, Vitest `alias`). It covers
 * what the sample uses and nothing more; it grows with the extension.
 */
export const VSCODE_STUB = `// Stands in for the 'vscode' module in unit tests: that module exists only
// inside the extension host. Extend it as the extension reaches for more API.
const registered = new Map<string, (...arguments_: unknown[]) => unknown>()

export const commands = {
  registerCommand (id: string, handler: (...arguments_: unknown[]) => unknown): { dispose: () => void } {
    registered.set(id, handler)

    return { dispose: () => { registered.delete(id) } }
  },
  getCommands (): Promise<string[]> {
    return Promise.resolve(registered.keys().toArray())
  },
  executeCommand (id: string, ...arguments_: unknown[]): Promise<unknown> {
    return Promise.resolve(registered.get(id)?.(...arguments_))
  },
}

export const window = {
  showInformationMessage (_message: string): Promise<undefined> {
    return Promise.resolve(undefined)
  },
}
`

/** Where {@link VSCODE_STUB} is written, relative to the project root. */
const VSCODE_STUB_PATH = 'test/vscode.stub.ts'

/**
 * Points the project's test runner at {@link VSCODE_STUB} for the `vscode` specifier.
 *
 * @remarks
 * Edits the config the generator just wrote at a line it always writes
 * (`testEnvironment: 'node',` for Jest, `environment: 'node',` for Vitest), and
 * throws if that anchor is gone rather than leaving a project whose first test of
 * real extension code fails to resolve `vscode` with no hint why.
 *
 * @param projectRoot - Absolute path to the extension project.
 * @param testRunner - The workspace's test runner.
 * @returns Nothing.
 * @throws Error when the generated config no longer has the expected anchor line.
 * @typeParam None - this function has no generic type parameters.
 */
function mapVscodeToStub (projectRoot: string, testRunner: WorkspaceStack['testRunner']): void {
  const [file, anchor, mapping] = testRunner === 'jest'
    ? ['jest.config.cts', "testEnvironment: 'node',", `moduleNameMapper: { '^vscode$': '<rootDir>/${VSCODE_STUB_PATH}' },`]
    : ['vitest.config.mts', "environment: 'node',", `alias: { vscode: \`\${import.meta.dirname}/${VSCODE_STUB_PATH}\` },`]
  const path = join(projectRoot, file)
  const content = fileExists(path) ? readFileSync(path, 'utf8') : ''
  const line = content.split('\n').find(candidate => candidate.trim() === anchor)
  if (line === undefined) {
    throw new Error(`${file} has no "${anchor}" line to map the vscode module after; map 'vscode' to ${VSCODE_STUB_PATH} by hand.`)
  }
  const indent = line.slice(0, line.indexOf(anchor))
  // A replacer function, not a string: the Jest mapping holds `'^vscode$'`, and in a
  // replacement STRING `$'` means "the text after the match", which spliced the rest
  // of the file into the middle of the line (caught by the spec).
  writeFileEnsured(path, content.replace(line, () => `${line}\n${indent}${mapping}`))
}

/**
 * Installs the extension toolchain at the workspace root.
 *
 * @remarks
 * Root devDependencies, per the shared-dev-packages invariant: `@types/vscode` for
 * the API types and `@vscode/vsce` for packaging and publishing. Skipped when both
 * are already declared, so a second extension installs nothing.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when the install exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
function ensureVscodeToolchain (workspaceRoot: string): void {
  const missing = ['@types/vscode', '@vscode/vsce'].filter(name => !hasPlugin(workspaceRoot, name))
  if (missing.length === 0) {
    return
  }
  logger.step(`Installing the VS Code extension toolchain (${missing.join(', ')})`)
  if (runShell('npm', ['install', '--save-dev', ...missing, '--no-audit', '--no-fund'], workspaceRoot) !== 0) {
    throw new Error(`npm install of ${missing.join(', ')} failed`)
  }
}

/**
 * The publisher a new extension gets when `--publisher` is not given.
 *
 * @remarks
 * The workspace's npm scope without the `@`, which is usually the organisation's
 * name and so a sensible first guess. It only has to be right before the first
 * publish: the Marketplace rejects a publisher id the token does not own.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns A publisher id.
 * @throws Never - an unreadable or unscoped root name falls back to the bare name.
 * @typeParam None - this function has no generic type parameters.
 */
function defaultPublisher (workspaceRoot: string): string {
  const { name } = readJson<{ name?: string }>(join(workspaceRoot, 'package.json'))

  return (name ?? 'publisher').replace(/^@/, '').split('/', 1)[0]
}

/**
 * Reshapes the generated manifest into an extension manifest and rewires its build.
 *
 * @remarks
 * - `name` loses its scope: `vsce` rejects scoped names. `nx.name` pins the Nx
 *   project name to the folder, so `name` and `displayName` are free to change
 *   afterwards (the Marketplace id need not match the folder, #247); without it Nx
 *   takes the project name from `name`, and renaming the extension would orphan
 *   every root script, task and launch entry that names the project.
 * - `engines.vscode` is pinned to the installed `@types/vscode` (`vsce` refuses a
 *   package whose types are newer than its engine range).
 * - The build bundles (`bundle`, `thirdParty`): a `.vsix` ships no `node_modules`,
 *   so the generator's un-bundled mirror of the source tree cannot run in the
 *   extension host. `vscode` stays external, it is the host's.
 *   `generatePackageJson: false`, because a `dist/package.json` confuses `vsce`.
 * - The generator's `serve` and prune targets go: an extension is not started with
 *   `node`, and it is never deployed with an installed `node_modules`.
 *
 * @param projectRoot - Absolute path to the extension project.
 * @param name - The project name.
 * @param publisher - The Marketplace publisher id.
 * @param typesVersion - The installed `@types/vscode` version.
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error.
 * @typeParam None - this function has no generic type parameters.
 */
function reshapeManifest (projectRoot: string, name: string, publisher: string, typesVersion: string): void {
  const manifestPath = join(projectRoot, 'package.json')
  const manifest = readJson<Record<string, unknown> & {
    nx?: { tags?: string[]; targets?: Record<string, { options?: Record<string, unknown> }> }
  }>(manifestPath)
  const { nx = {}, ...rest } = manifest
  const targets = { ...nx.targets }
  for (const target of ['serve', 'prune', 'prune-lockfile', 'copy-workspace-modules']) {
    delete targets[target]
  }
  const build = targets.build ?? {}
  targets.build = {
    ...build,
    options: {
      ...build.options,
      bundle:              true,
      thirdParty:          true,
      external:            ['vscode'],
      generatePackageJson: false,
    },
  }
  writeFileEnsured(
    manifestPath,
    toJson({
      ...rest,
      name,
      displayName:      name,
      version:          rest.version ?? '0.0.1',
      publisher,
      engines:          { vscode: `^${typesVersion}` },
      categories:       ['Other'],
      main:             './dist/main.js',
      activationEvents: [],
      contributes:      { commands: [{ command: `${name}.hello`, title: `${name}: Hello` }] },
      nx:               { ...nx, name, tags: [...new Set([...(nx.tags ?? []), VSCODE_EXTENSION_TAG])], targets },
    }),
  )
}

/**
 * Adds the `vscode` types to a project tsconfig.
 *
 * @remarks
 * Both the app and the spec config need them: a `types` list stops TypeScript from
 * loading every `@types` package, and `vscode` is declared only by `@types/vscode`'s
 * ambient module, so without the entry `import * as vscode from 'vscode'` does not
 * resolve at all.
 *
 * @param tsconfigPath - Absolute path to the tsconfig.
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error.
 * @typeParam None - this function has no generic type parameters.
 */
function addVscodeTypes (tsconfigPath: string): void {
  if (!fileExists(tsconfigPath)) {
    return
  }
  const tsconfig = readJson<{ compilerOptions?: { types?: string[] } }>(tsconfigPath)
  const compilerOptions = tsconfig.compilerOptions ?? {}
  const types = compilerOptions.types ?? []
  if (types.includes('vscode')) {
    return
  }
  writeFileEnsured(tsconfigPath, toJson({ ...tsconfig, compilerOptions: { ...compilerOptions, types: [...types, 'vscode'] } }))
}

/**
 * The `package` target: one universal `.vsix`, or one per Marketplace target with a sidecar.
 *
 * @remarks
 * Outputs are listed one per file rather than as a glob, so Nx caches and restores
 * exactly the packages this project writes and never another project's in the
 * shared `dist/drop`. The work is in {@link VSCODE_EXTENSION_SCRIPT}.
 *
 * @param name - The project name.
 * @param sidecar - The `go-app` whose binaries ship in `bin/`, when any.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeExtensionPackageTarget (name: string, sidecar?: string): Record<string, unknown> {
  const outputs = sidecar
    ? Object.keys(VSCODE_SIDECAR_TARGETS).map(target => `{workspaceRoot}/dist/drop/${name}-${target}.vsix`)
    : [`{workspaceRoot}/dist/drop/${name}.vsix`]

  return {
    executor:  'nx:run-commands',
    dependsOn: ['build'],
    outputs,
    options:   { command: `node ${VSCODE_EXTENSION_SCRIPT_PATH} package apps/${name}${sidecar ? ` --sidecar ${sidecar}` : ''}` },
  }
}

/**
 * The `nx-release-publish` target: publish the packaged `.vsix` files to the Marketplace.
 *
 * @remarks
 * Depends on `package`, so it packages the version `nx release` has just written,
 * never a stale one. Gated on a Marketplace credential (Entra ID or `VSCE_PAT`) inside the script (see
 * {@link VSCODE_EXTENSION_SCRIPT}).
 *
 * @param name - The project name.
 * @param sidecar - The `go-app` whose binaries ship in `bin/`, when any.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeExtensionPublishTarget (name: string, sidecar?: string): Record<string, unknown> {
  return {
    executor:  'nx:run-commands',
    dependsOn: ['package'],
    options:   { command: `node ${VSCODE_EXTENSION_SCRIPT_PATH} publish apps/${name}${sidecar ? ` --sidecar ${sidecar}` : ''}` },
  }
}

/**
 * Adds a `<name>: debug` launch configuration and the task it builds with.
 *
 * @remarks
 * `extensionHost` opens a second VS Code window with the extension loaded from
 * `apps/<name>`. The pre-launch task builds the `development` configuration, which
 * keeps source maps, so breakpoints in `src/` bind. Named `<name>: debug`, never
 * `mnci: …`: the overlay replaces every launch entry with that prefix on
 * `mnci upgrade`, and this one is per-project state, like the tasks.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name.
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error.
 * @typeParam None - this function has no generic type parameters.
 */
function addDebugLaunch (workspaceRoot: string, name: string): void {
  const file = readdirSync(workspaceRoot).find(entry => entry.endsWith('.code-workspace'))
  if (file === undefined) {
    return
  }
  const path = join(workspaceRoot, file)
  const workspace = readCodeWorkspace<{
    folders?: { name?: string }[]
    tasks?:   { version?: string; tasks?: Record<string, unknown>[] }
    launch?:  { version?: string; configurations?: Record<string, unknown>[] }
  }>(path) ?? {}
  const folder = `\${workspaceFolder:${workspace.folders?.[0]?.name ?? file.replace(/\.code-workspace$/, '')}}`
  const taskLabel = `${name}: build (development)`
  const launchName = `${name}: debug`
  const tasks = (workspace.tasks?.tasks ?? []).filter(task => task.label !== taskLabel)
  const configurations = (workspace.launch?.configurations ?? []).filter(configuration => configuration.name !== launchName)
  writeFileEnsured(
    path,
    toJson({
      ...workspace,
      tasks: {
        version: workspace.tasks?.version ?? '2.0.0',
        tasks:   [...tasks, { label: taskLabel, type: 'shell', command: `npx nx run ${name}:build:development`, problemMatcher: [] }],
      },
      launch: {
        version:        workspace.launch?.version ?? '0.2.0',
        configurations: [
          ...configurations,
          {
            name:          launchName,
            type:          'extensionHost',
            request:       'launch',
            args:          [`--extensionDevelopmentPath=${folder}/apps/${name}`],
            outFiles:      [`${folder}/apps/${name}/dist/**/*.js`],
            preLaunchTask: taskLabel,
          },
        ],
      },
    }),
  )
}

/**
 * Rewrites {@link VSCODE_EXTENSION_SCRIPT_PATH} when the workspace has an extension.
 *
 * @remarks
 * Called by `mnci upgrade`, so a fix to the script reaches every workspace that
 * uses it, and a workspace with no extension never gains the file.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Whether the file changed (an up-to-date script is left alone).
 * @throws Propagates any `fs` error writing the file.
 * @typeParam None - this function has no generic type parameters.
 */
export function refreshVscodeExtensionScript (workspaceRoot: string): boolean {
  const apps = join(workspaceRoot, 'apps')
  let entries: string[]
  try {
    entries = readdirSync(apps)
  } catch {
    return false
  }
  const hasExtension = entries.some((entry) => {
    const manifestPath = join(apps, entry, 'package.json')
    if (!fileExists(manifestPath)) {
      return false
    }
    const tags = readJson<{ nx?: { tags?: string[] } }>(manifestPath).nx?.tags ?? []

    return tags.includes(VSCODE_EXTENSION_TAG)
  })
  const path = join(workspaceRoot, VSCODE_EXTENSION_SCRIPT_PATH)
  if (!hasExtension || (fileExists(path) && readFileSync(path, 'utf8') === VSCODE_EXTENSION_SCRIPT)) {
    return false
  }
  writeFileEnsured(path, VSCODE_EXTENSION_SCRIPT)

  return true
}

/**
 * Pins `nx.name` on every extension that lacks it.
 *
 * @remarks
 * Extensions added by `@mnci/cli` 4.12.0 have no `nx.name`, so their Nx project
 * name still comes from the manifest `name` (#247). Pinning it to that same value
 * changes nothing today and makes a later rename of the extension safe.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The workspace-relative manifests that were updated.
 * @throws Propagates any `fs`/JSON error.
 * @typeParam None - this function has no generic type parameters.
 */
export function pinVscodeExtensionProjectNames (workspaceRoot: string): string[] {
  const apps = join(workspaceRoot, 'apps')
  let entries: string[]
  try {
    entries = readdirSync(apps)
  } catch {
    return []
  }
  const updated: string[] = []
  for (const entry of entries) {
    const manifestPath = join(apps, entry, 'package.json')
    if (!fileExists(manifestPath)) {
      continue
    }
    const manifest = readJson<{ name?: string; nx?: { name?: string; tags?: string[] } }>(manifestPath)
    if (!manifest.nx?.tags?.includes(VSCODE_EXTENSION_TAG) || manifest.nx.name !== undefined || manifest.name === undefined) {
      continue
    }
    writeFileEnsured(manifestPath, toJson({ ...manifest, nx: { ...manifest.nx, name: manifest.name } }))
    updated.push(`apps/${entry}/package.json`)
  }

  return updated
}

/**
 * What `mnci add vscode-extension` takes beyond the name.
 *
 * @remarks
 * Both come from CLI flags (`--publisher`, `--sidecar`); neither is prompted for,
 * because both have a sensible absence: a default publisher and no sidecar.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface VscodeExtensionOptions {
  /** The Marketplace publisher id; defaults to the workspace scope without `@`. */
  publisher?: string
  /** A `go-app` whose six-platform build ships inside the extension, in `bin/`. */
  sidecar?:   string
}

/**
 * Re-syncs `package-lock.json` with the reshaped manifest.
 *
 * @remarks
 * `apps/*` is an npm workspace, so the lock records each app under its manifest
 * `name`. The generator installed under its scoped name, and
 * {@link reshapeManifest} unscopes it, which `vsce` requires. Left alone, the lock
 * still names the old package, and CI's `npm ci` refuses it ("Missing: <name> from
 * lock file", #251, measured on a real workspace). A failure here only warns, as
 * the root-dependency relocation does: the project exists, and `npm install` fixes
 * the lock.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name, for the message.
 * @returns Nothing.
 * @throws Never - a failed refresh is reported, not thrown.
 * @typeParam None - this function has no generic type parameters.
 */
function refreshLockFile (workspaceRoot: string, name: string): void {
  if (runShell('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], workspaceRoot) !== 0) {
    logger.warn(`Could not refresh package-lock.json after reshaping ${name}'s manifest. Run 'npm install' before committing.`)
  }
}

/**
 * Adds a VS Code extension: `@nx/node:application`, bundled, packaged with `vsce`.
 *
 * @remarks
 * The generator gives a TypeScript app with the workspace's test runner; this turns
 * it into an extension (see {@link reshapeManifest}) and adds what a Marketplace
 * extension needs: `package` (`.vsix` into `dist/drop`, per platform with a
 * `--sidecar`), `nx-release-publish`, a `vscode` stub for unit tests, a
 * `.vscodeignore`, and an Extension Development Host launch entry. Tagged
 * {@link VSCODE_EXTENSION_TAG}, which puts it in `nx release` scope.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param stack - The workspace's test runner.
 * @param options - Publisher and sidecar.
 * @returns Nothing.
 * @throws Error when the sidecar is not a Go app, or a generator or install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addVscodeExtension (
  workspaceRoot: string,
  name: string,
  stack: WorkspaceStack,
  options: VscodeExtensionOptions = {},
): void {
  const { sidecar } = options
  if (sidecar !== undefined && !fileExists(join(workspaceRoot, 'apps', sidecar, 'project.json'))) {
    throw new Error(`--sidecar ${sidecar}: no Go app at apps/${sidecar}. Add it first with \`mnci add go-app ${sidecar}\`.`)
  }
  runNodeApp(workspaceRoot, name, stack, 'none')
  ensureVscodeToolchain(workspaceRoot)
  const projectRoot = join(workspaceRoot, 'apps', name)
  const typesVersion = readJson<{ version: string }>(join(workspaceRoot, 'node_modules/@types/vscode/package.json')).version
  reshapeManifest(projectRoot, name, options.publisher ?? defaultPublisher(workspaceRoot), typesVersion)
  addVscodeTypes(join(projectRoot, 'tsconfig.app.json'))
  addVscodeTypes(join(projectRoot, 'tsconfig.spec.json'))
  writeFileEnsured(join(projectRoot, 'src/main.ts'), vscodeExtensionMain(name))
  writeFileEnsured(join(projectRoot, 'src/main.spec.ts'), vscodeExtensionMainSpec(name))
  writeFileEnsured(join(projectRoot, VSCODE_STUB_PATH), VSCODE_STUB)
  mapVscodeToStub(projectRoot, stack.testRunner)
  writeFileEnsured(join(projectRoot, '.vscodeignore'), VSCODE_IGNORE)
  writeFileEnsured(join(workspaceRoot, VSCODE_EXTENSION_SCRIPT_PATH), VSCODE_EXTENSION_SCRIPT)
  addNxTargets(join(projectRoot, 'package.json'), {
    'package':            vscodeExtensionPackageTarget(name, sidecar),
    'nx-release-publish': vscodeExtensionPublishTarget(name, sidecar),
  })
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, { build: true })
  addDebugLaunch(workspaceRoot, name)
  refreshLockFile(workspaceRoot, name)
}
