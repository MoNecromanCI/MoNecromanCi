import { join } from 'node:path'
import { runNx, runShell } from '../nx-workspace'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import {
  addNxTargets,
  ensureAdmZip,
  hasPlugin,
  registerProjectCommands,
  removeGeneratedEslintConfig,
  type NodeFramework,
  type WorkspaceStack,
} from './post-generation.use-case'

/**
 * Ensures an Nx plugin is installed in the workspace, installing it on first use.
 *
 * @remarks
 * `nx add` installs the package and runs its init generator — the Nx-native
 * way to bring a plugin into an existing workspace. Same pattern as
 * `add/reactApp.ts`'s `ensurePlugin`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param packageName - The plugin package (e.g. `@nx/node`).
 * @returns Nothing.
 * @throws Error when the underlying `nx add` exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
function ensurePlugin (workspaceRoot: string, packageName: string): void {
  if (hasPlugin(workspaceRoot, packageName)) {
    return
  }
  logger.step(`Installing Nx plugin ${packageName}`)
  runNx(['add', packageName], workspaceRoot)
}

/**
 * Generates a Node app with the official `@nx/node:application` generator.
 *
 * @remarks
 * Plain delegation — no framework-specific logic here at all, `framework` is
 * passed straight through to the generator. `--bundler=esbuild` is requested
 * either way, but verified empirically that `--framework=nest` silently
 * overrides it: NestJS needs its own webpack build (decorator/DI metadata
 * emission esbuild's transform-only approach can't produce), so a
 * `nest`-flavoured app builds to a single webpack-bundled `dist/main.js`
 * instead of the esbuild non-bundled mirrored-tree + shim the other
 * frameworks (and `none`) produce. {@link nodeAppPackageTarget} needs no
 * framework branch regardless — either shape's runnable entry is
 * `dist/main.js`, so zipping the whole `dist` folder works unchanged. Both
 * `node-app` and `node-function-app` generate identically (function apps
 * always pass `'none'` — see {@link addNodeFunctionApp}) — the function app
 * is this plus an Azure Functions v2 file overlay, the same split already
 * used for `python-app`/`python-function-app` (`add/python.ts`).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param stack - The workspace's chosen linter/test runner.
 * @param framework - The HTTP framework to scaffold (`none` for a bare app).
 * @returns Nothing.
 * @throws Error when the generator exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
export function runNodeApp (
  workspaceRoot: string,
  name: string,
  stack: WorkspaceStack,
  framework: NodeFramework,
): void {
  ensurePlugin(workspaceRoot, '@nx/node')
  runNx(
    [
      'g',
      '@nx/node:application',
      `apps/${name}`,
      '--bundler=esbuild',
      `--unitTestRunner=${stack.testRunner}`,
      '--linter=none',
      '--e2eTestRunner=none',
      `--framework=${framework}`,
      '--no-interactive',
    ],
    workspaceRoot,
  )
  const appRoot = join(workspaceRoot, 'apps', name)
  separateDeclarationOutput(appRoot)
  repairAssetMapping(appRoot, name)
}

/**
 * Moves the app's declaration output out of the folder its own build empties.
 *
 * @remarks
 * `@nx/node:application --bundler=esbuild` writes `outDir: 'dist'` and
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
function separateDeclarationOutput (appRoot: string): void {
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

/**
 * Rewrites the generated asset mapping so assets land where the app reads them.
 *
 * @remarks
 * The generator writes the **string** form, `assets: ['apps/<name>/src/assets']`.
 * Under `@nx/esbuild` 23 that does not put the files at `dist/assets/`; measured
 * on a real build, a file placed in `src/assets` does not reach `dist` **at
 * all**. The generated `src/assets/.gitkeep` hides it until someone adds a real
 * asset, and then code reading `new URL('../assets/...', import.meta.url)` from
 * `dist/functions/*.js` simply finds nothing.
 *
 * The object form states input, glob and output explicitly, and with it the same
 * file lands at `dist/assets/<file>` — verified on a generated workspace.
 *
 * @param appRoot - Absolute path to the generated app's directory.
 * @param name - The app's project name, used to build the workspace-relative input.
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error reading or writing the manifest.
 * @typeParam None - this function has no generic type parameters.
 */
function repairAssetMapping (appRoot: string, name: string): void {
  const manifestPath = join(appRoot, 'package.json')
  if (!fileExists(manifestPath)) {
    return
  }
  const manifest = readJson<{
    nx?: { targets?: { build?: { options?: Record<string, unknown> } } }
  }>(manifestPath)
  const options = manifest.nx?.targets?.build?.options
  if (!options || !Array.isArray(options.assets)) {
    return
  }
  options.assets = options.assets.map(asset =>
    (typeof asset === 'string'
      ? { input: asset, glob: '**/*', output: asset.replace(`apps/${name}/src/`, '') }
      : asset),
  )
  writeFileEnsured(manifestPath, toJson(manifest))
}

/**
 * The `package` target for a plain Node app: zip its build output into the drop.
 *
 * @remarks
 * `@nx/esbuild:esbuild --bundle=false` mirrors the full workspace-relative
 * source tree into `apps/<name>/dist` (e.g. `dist/apps/<name>/src/main.js`)
 * plus a `dist/main.js` shim that `require`s it — so zipping the whole `dist`
 * folder is the complete, runnable output. Basename exactly `node-app-<name>`,
 * the string CI turns into the per-app build tag. Same cross-platform
 * `adm-zip` one-liner used throughout `add`.
 *
 * @param name - The Node app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function nodeAppPackageTarget (name: string): Record<string, unknown> {
  const zip = `dist/drop/node-app-${name}.zip`
  const command = `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('apps/${name}/dist');z.writeZip('${zip}')"`

  return {
    executor:  'nx:run-commands',
    dependsOn: ['build'],
    outputs:   [`{workspaceRoot}/${zip}`],
    options:   { command },
  }
}

/**
 * Adds a plain Node app: `@nx/node:application` plus a packaging target.
 *
 * @remarks
 * Pure delegation to the official generator (esbuild, non-bundled unless
 * `framework` forces its own build — see {@link runNodeApp}) — no custom
 * build rewiring, no relocated output; every kind builds to its own
 * Nx-default location. {@link nodeAppPackageTarget} is the one thing the
 * generator doesn't do: zip the build into the CI drop.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param stack - The workspace's chosen linter/test runner.
 * @param framework - The HTTP framework to scaffold (defaults to `none`, a bare Node app).
 * @returns Nothing.
 * @throws Error when the generator or a required install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addNodeApp (
  workspaceRoot: string,
  name: string,
  stack: WorkspaceStack,
  framework: NodeFramework = 'none',
): void {
  runNodeApp(workspaceRoot, name, stack, framework)
  ensureAdmZip(workspaceRoot)
  addNxTargets(join(workspaceRoot, 'apps', name, 'package.json'), {
    package: nodeAppPackageTarget(name),
  })
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, { build: true, start: `nx run ${name}:serve` })
}

/**
 * Ensures `@azure/functions` is installed at the workspace root.
 *
 * @remarks
 * Unlike the removed `@nxazure/func` plugin (whose generators pulled this in
 * as a side effect), a plain `@nx/node:application` app has no Azure
 * Functions dependency by default, so `add node-function-app` installs it
 * for real — the version then gets read back and stamped into the app's own
 * manifest (see {@link repairNodeFunctionAppManifest}) for Azure's deploy-time
 * `npm install` (Oryx) to resolve.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when the install exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
function ensureAzureFunctionsPackage (workspaceRoot: string): void {
  if (hasPlugin(workspaceRoot, '@azure/functions')) {
    return
  }
  logger.step('Installing @azure/functions')
  if (
    runShell('npm', ['install', '@azure/functions', '--no-audit', '--no-fund'], workspaceRoot) !== 0
  ) {
    throw new Error('npm install of @azure/functions failed')
  }
}

/**
 * The bundle entry point written into every generated Node function app.
 *
 * @remarks
 * `@nx/esbuild:esbuild` only includes what is reachable from `main.ts` — the
 * same convention the removed hand-rolled function app used — so add one
 * import per function slice you create under `src/`. The import
 * runs `app.http(...)` (or another trigger registration) as a side effect;
 * nothing needs to be re-exported.
 */
export const NODE_FUNCTION_APP_MAIN = `// esbuild only includes what is reachable from here, so add one import per
// function slice you create under src/ (through its index).
import './hello'
`

/**
 * The bundle entry point of a function app scaffolded with `--empty`: no function yet.
 *
 * @remarks
 * Same convention as {@link NODE_FUNCTION_APP_MAIN}, with nothing to import.
 */
export const NODE_FUNCTION_APP_MAIN_EMPTY = `// esbuild only includes what is reachable from here, so import each function slice
// you create under src/ (through its index).
export {}
`

/**
 * The `host.json` written into a generated Node function app.
 *
 * @remarks
 * Identical shape to the Python function app's `host.json` (written by
 * `@mnci/nx-python-pip:function-application`, the plugin `add/python.ts`
 * delegates to) — the schema is language-agnostic. The v4 extension bundle
 * is what the Functions host uses to resolve bindings; `version: 2.0` is the
 * runtime schema. Deliberately minimal.
 */
export const NODE_FUNCTION_APP_HOST_JSON = `{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
`

/**
 * The Azure Functions v4 HTTP trigger written into a generated Node function app.
 *
 * @remarks
 * The Node v4 programming model: `app.http(...)` registers a route at import
 * time. The handler only adapts the transport — it decodes the query, calls the
 * use case ({@link NODE_FUNCTION_APP_GREET_USE_CASE}) and shapes the response — so
 * the use case's spec needs no `@azure/functions` mocking. Anonymous auth keeps the sample
 * runnable locally with `func start`.
 */
export const NODE_FUNCTION_APP_HELLO = `import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { greet } from './greet.use-case'

async function hello(request: HttpRequest): Promise<HttpResponseInit> {
  const name = request.query.get('name') ?? 'world'
  return { body: greet(name).message }
}

app.http('hello', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'hello',
  handler: hello,
})
`

/**
 * The barrel of the sample function's slice.
 *
 * @remarks
 * The one door `main.ts` imports through, as the slice rules require of a sibling.
 */
export const NODE_FUNCTION_APP_HELLO_BARREL = `export * from './hello.handler'
`

/**
 * The sample contract written into every generated Node function app.
 *
 * @remarks
 * The data the use case returns and the handler shapes into a response: a worked
 * example of a `.contract.ts`.
 */
export const NODE_FUNCTION_APP_GREETING_CONTRACT = `/** What greeting someone returns. */
export interface Greeting {
  readonly message: string
}
`

/**
 * The sample use case written into every generated Node function app.
 *
 * @remarks
 * One outcome, free of the transport: it needs no `@azure/functions`, so the
 * generator's own jest/vitest wiring has a real passing test out of the box.
 * Delete it once you have your own.
 */
export const NODE_FUNCTION_APP_GREET_USE_CASE = `import type { Greeting } from './greeting.contract'

export function greet (name: string): Greeting {
  return { message: 'Hello, ' + name + '!' }
}
`

/**
 * The sample spec proving the function app's test target runs.
 *
 * @remarks
 * Deliberately dependency-free (no Azure SDK), so it passes on a bare
 * workspace under either jest or vitest — `@nx/node:application` wires the
 * chosen runner natively (unlike the removed hand-rolled function app, which
 * carried no test setup of its own).
 */
export const NODE_FUNCTION_APP_GREET_SPEC = `import { greet } from './greet.use-case'

describe('greet', () => {
  it('greets a name', () => {
    expect(greet('world')).toEqual({ message: 'Hello, world!' })
  })
})
`

/**
 * Repairs a Node function app's manifest for an Azure deploy: `main` + the real dependency.
 *
 * @remarks
 * `@nx/esbuild:esbuild --bundle=false` writes a `dist/main.js` shim that
 * `require`s the compiled entry (verified empirically) — so `main` is
 * `dist/main.js`, resolved relative to wherever this manifest sits. That
 * makes the source layout (`host.json` + `package.json` + `dist/main.js`,
 * once built, all under `apps/<name>`) directly `func start`-able, which
 * matters: unlike `python-function-app`, there is no pre-build step Azure
 * Functions Core Tools does for you, so the local `start` target
 * ({@link nodeFunctionAppStartTarget}) depends on `build` and then runs
 * `func start` right here, no staging copy needed.
 * {@link nodeFunctionAppPackageTarget}
 * mirrors this same relative layout inside the deploy zip (nesting `dist/`
 * rather than flattening it), so one `main` value is correct for both local
 * dev and the Azure deploy — verified against a real generated app that
 * `main.js` sitting flat (the old shape) would have broken `func start`
 * entirely (`dist/main.js` never exists at `apps/<name>/main.js`).
 * `@azure/functions` is added for real (not just referenced): Azure's
 * deploy-time Oryx build reads this manifest's `dependencies` and runs
 * `npm install` there — verified empirically that a plain `npm install` in a
 * simulated deploy folder (no bundled `node_modules`) resolves and runs
 * correctly once the dependency is declared, mirroring exactly how
 * `python-function-app` already relies on Azure's Python Oryx build
 * installing `requirements.txt` at deploy time.
 *
 * @param nodeFunctionAppRoot - Absolute path to the function app's directory.
 * @param workspaceRoot - Absolute path to the workspace (to read the
 * installed `@azure/functions` version).
 * @returns Nothing.
 * @throws Propagates any `fs`/JSON error reading or writing the manifest.
 * @typeParam None - this function has no generic type parameters.
 */
function repairNodeFunctionAppManifest (nodeFunctionAppRoot: string, workspaceRoot: string): void {
  const manifestPath = join(nodeFunctionAppRoot, 'package.json')
  const manifest = readJson<Record<string, unknown>>(manifestPath)
  const azureFunctionsVersion = readJson<{ version: string }>(
    join(workspaceRoot, 'node_modules/@azure/functions/package.json'),
  ).version
  const dependencies = (manifest.dependencies as Record<string, string> | undefined) ?? {}
  writeFileEnsured(
    manifestPath,
    toJson({
      ...manifest,
      main:         'dist/main.js',
      dependencies: { ...dependencies, '@azure/functions': `^${azureFunctionsVersion}` },
    }),
  )
}

/**
 * The `package` target for a Node Azure Function: zip the deployable folder.
 *
 * @remarks
 * Zips `apps/<name>/dist` (the esbuild output — the `main.js` shim plus the
 * mirrored source tree) **nested under `dist/`**, alongside `host.json` and
 * the repaired `package.json`, into `dist/drop/node-function-app-<name>.zip`
 * — the exact same relative layout as the source directory, so the deployed
 * `package.json`'s `main: 'dist/main.js'` resolves identically whether run
 * locally (`func start` in `apps/<name>`) or from the unzipped deploy
 * artifact (see {@link repairNodeFunctionAppManifest}). No `node_modules`
 * bundled: Azure's Oryx build installs real dependencies from the zipped
 * `package.json` at deploy time. Basename exactly `node-function-app-<name>`
 * (the CI build tag).
 *
 * @param name - The function app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function nodeFunctionAppPackageTarget (name: string): Record<string, unknown> {
  const zip = `dist/drop/node-function-app-${name}.zip`
  const root = `apps/${name}`
  // The third argument to addLocalFolder is a filter; declarations are dropped
  // here rather than at build time. `declaration: false` on the esbuild target
  // is not available: it collides with the `composite`/`declarationMap` the
  // workspace's own `typecheck` needs, and the build then dies on TS5069
  // (measured, both alone and with declarationMap turned off beside it). An app
  // has no consumers for declarations, so the deploy artifact simply omits them.
  const command = String.raw`node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('${root}/dist','dist',(e)=>!/\.d\.ts(\.map)?$/.test(e));z.addLocalFile('${root}/host.json');z.addLocalFile('${root}/package.json');z.writeZip('${zip}')"`

  return {
    executor:  'nx:run-commands',
    dependsOn: ['build'],
    outputs:   [`{workspaceRoot}/${zip}`],
    options:   { command },
  }
}

/**
 * Replaces Nx's no-op `prune` with one that carries the root `overrides` across.
 *
 * @remarks
 * `@nx/js:prune-lockfile` cuts `dist/package-lock.json` from the root lockfile,
 * so the pruned lockfile already has every `overrides` entry applied — while the
 * `dist/package.json` written beside it has no `overrides` key at all. When an
 * override changes the version of a package **inside the pruned tree**, the two
 * disagree and the container build's `npm ci --omit=dev` refuses:
 * it reports that the manifest and the lock file are not in sync, naming the
 * package whose version the override moved as missing from the lock file.
 *
 * Conditional, not universal: an override that misses the app's runtime tree
 * changes nothing, which is why a generated workspace's own SECURITY_OVERRIDES
 * (dev tooling — brace-expansion, smol-toml, nanoid) do not trigger it and a
 * plain `npm ci` in `dist` succeeds. It bites the moment a workspace pins
 * something the app actually ships.
 *
 * Copying every root entry rather than only the intersecting ones is deliberate:
 * npm accepts `overrides` naming packages absent from the tree, and computing
 * the intersection here would need the resolved tree this step does not have.
 *
 * Nx's own `prune` is `nx:noop` over `prune-lockfile` + `copy-workspace-modules`,
 * so the same `dependsOn` is kept and only the body changes.
 *
 * @param name - The app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function nodeFunctionAppPruneTarget (name: string): Record<string, unknown> {
  const pruned = `apps/${name}/dist/package.json`
  const command = String.raw`node -e "const fs=require('node:fs');const root=JSON.parse(fs.readFileSync('package.json','utf8'));const o=root.overrides;if(!o||Object.keys(o).length===0){console.log('No root overrides - nothing to carry into the pruned manifest.');process.exit(0)}const p='${pruned}';if(!fs.existsSync(p)){console.error('Pruned manifest not found at '+p+' - run the prune-lockfile target first.');process.exit(1)}const m=JSON.parse(fs.readFileSync(p,'utf8'));m.overrides={...o,...m.overrides};fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n');console.log('Carried '+Object.keys(o).length+' root override(s) into '+p)"`

  return {
    executor:  'nx:run-commands',
    dependsOn: ['prune-lockfile', 'copy-workspace-modules'],
    options:   { command },
  }
}

/**
 * The `start` target for a Node Azure Function: `func start`, locally.
 *
 * @remarks
 * Depends on `build` so `dist/main.js` exists before Core Tools tries to load
 * it via the manifest's `main` field ({@link repairNodeFunctionAppManifest}).
 * `continuous: true` marks it as a long-running dev-server task, the same
 * shape `@nx/js:node`'s own inferred `serve` target uses — Nx does not try to
 * cache or wait out a process that never exits on its own. Requires Azure
 * Functions Core Tools locally (never a prerequisite for
 * `add node-function-app` itself — see `ensureAzureFunctionsPackage`'s docs).
 *
 * @param name - The function app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function nodeFunctionAppStartTarget (name: string): Record<string, unknown> {
  return {
    executor:   'nx:run-commands',
    dependsOn:  ['build'],
    continuous: true,
    options:    { command: 'func start', cwd: `apps/${name}` },
  }
}

/**
 * Adds a Node Azure Function: `@nx/node:application` plus the Azure Functions v4 shape.
 *
 * @remarks
 * Same generator as `node-app` — the difference is purely the overlay:
 * `@azure/functions` installed for real, an HTTP-trigger sample
 * ({@link NODE_FUNCTION_APP_HELLO}) + a pure, test-covered helper, `host.json`,
 * and the manifest repair the deploy needs. The `func` CLI is never invoked —
 * unlike the removed `@nxazure/func` plugin, nothing here shells out to it,
 * so it isn't a prerequisite for `add node-function-app` (only for local
 * `func start`, same as `python-function-app`). Always `--framework=none` —
 * unlike `node-app`, no framework choice: the Azure Functions v4 programming
 * model registers its own routes and runs its own request lifecycle
 * ({@link NODE_FUNCTION_APP_HELLO}'s `app.http(...)`), so a full HTTP server
 * framework (Express/Fastify/Koa/Nest) doesn't apply here.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param stack - The workspace's chosen linter/test runner.
 * @param empty - Scaffold the app with no function: just the entry point and `host.json` (`--empty`).
 * @returns Nothing.
 * @throws Error when the generator or a required install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addNodeFunctionApp (
  workspaceRoot: string,
  name: string,
  stack: WorkspaceStack,
  empty = false,
): void {
  runNodeApp(workspaceRoot, name, stack, 'none')
  ensureAzureFunctionsPackage(workspaceRoot)
  const nodeFunctionAppRoot = join(workspaceRoot, 'apps', name)
  writeFileEnsured(join(nodeFunctionAppRoot, 'src/main.ts'), empty ? NODE_FUNCTION_APP_MAIN_EMPTY : NODE_FUNCTION_APP_MAIN)
  if (!empty) {
    // One slice per function: the handler adapts the transport, the use case is the
    // outcome, the contract is what it returns, and the barrel is the slice's door
    // (main.ts reaches the slice through that).
    const slice = join(nodeFunctionAppRoot, 'src/hello')
    writeFileEnsured(join(slice, 'hello.handler.ts'), NODE_FUNCTION_APP_HELLO)
    writeFileEnsured(join(slice, 'greet.use-case.ts'), NODE_FUNCTION_APP_GREET_USE_CASE)
    writeFileEnsured(join(slice, 'greet.use-case.spec.ts'), NODE_FUNCTION_APP_GREET_SPEC)
    writeFileEnsured(join(slice, 'greeting.contract.ts'), NODE_FUNCTION_APP_GREETING_CONTRACT)
    writeFileEnsured(join(slice, 'index.ts'), NODE_FUNCTION_APP_HELLO_BARREL)
  }
  writeFileEnsured(join(nodeFunctionAppRoot, 'host.json'), NODE_FUNCTION_APP_HOST_JSON)
  repairNodeFunctionAppManifest(nodeFunctionAppRoot, workspaceRoot)
  ensureAdmZip(workspaceRoot)
  addNxTargets(join(nodeFunctionAppRoot, 'package.json'), {
    package: nodeFunctionAppPackageTarget(name),
    prune:   nodeFunctionAppPruneTarget(name),
    start:   nodeFunctionAppStartTarget(name),
    // With no spec the runner exits non-zero; an empty scaffold must still pass `nx test`.
    ...(empty && { test: { options: { passWithNoTests: true } } }),
  })
  removeGeneratedEslintConfig(workspaceRoot, `apps/${name}`)
  registerProjectCommands(workspaceRoot, name, { build: true, start: `nx run ${name}:start` })
}
