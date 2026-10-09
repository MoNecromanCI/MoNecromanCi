import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runNx, runShell } from '../nx-workspace'
import { goAppExampleFiles, goLibraryExampleFiles } from './go-example.algorithm'
import { fileExists, writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import { goModulePrefix, registerNxGoPlugin } from '../go-workspace'
import { GO_CGO_TAG } from '../workspace-overlay'
import { makeGoAppReleasable } from './go-release.use-case'
import { assertWebApp, wireGoAppToWeb } from './go-web.use-case'
import { addProjectJsonTargets, ensureAdmZip, hasPlugin, registerProjectCommands } from './post-generation.use-case'

/**
 * Fails fast, with an install hint, when Go is not on the PATH.
 *
 * @remarks
 * Mirrors `ensurePython` in `add/python.ts`: probed before any install or
 * generator call so a missing toolchain surfaces as one clear sentence
 * rather than an opaque generator crash.
 *
 * @param workspaceRoot - Absolute path to the workspace (cwd for the probe).
 * @returns Nothing.
 * @throws Error when `go` cannot be run.
 * @typeParam None - this function has no generic type parameters.
 */
function ensureGo (workspaceRoot: string): void {
  if (runShell('go', ['version'], workspaceRoot) !== 0) {
    throw new Error('Go not found. Install Go 1.21+ first: https://go.dev/dl/')
  }
}

/**
 * Warns (without failing) when `golangci-lint` is not on the PATH.
 *
 * @remarks
 * Deliberately a warning, not an error: the generated `lint` target uses
 * `golangci-lint`, but a developer who only wants to build and test locally
 * should not be blocked at `add` time — CI installs it as its own step. Note
 * `@nx-go/nx-go`'s `lint` executor defaults to plain `go fmt` (formatting,
 * not linting), which is why mnci pins `golangci-lint` explicitly in the
 * target it writes.
 *
 * @param workspaceRoot - Absolute path to the workspace (cwd for the probe).
 * @returns Nothing.
 * @throws Never - a missing linter only produces a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function warnIfNoGolangciLint (workspaceRoot: string): void {
  if (runShell('golangci-lint', ['--version'], workspaceRoot) !== 0) {
    logger.warn(
      'golangci-lint not found — the generated lint target needs it. Install: https://golangci-lint.run/welcome/install/',
    )
  }
}

/**
 * The `@nx-go/nx-go` package spec to install.
 *
 * @remarks
 * Reads `MNCI_NX_GO_SPEC` so the e2e suite can pin or redirect the plugin
 * (e.g. to a local tarball) without touching this code; the published
 * package is the default for every real `mnci add go-*` call.
 *
 * Pinned to no particular version on purpose: `4.1.1` declares
 * `@nx/devkit ">= 20 < 23"` while `4.1.0` declares `">= 20 < 24"`, but that
 * range is a plain dependency rather than a peer, so npm simply nests its
 * own devkit copy. Verified empirically against a real Nx 23.1.0 workspace:
 * generators, `build`, `test` and `lint` all work under 4.1.1.
 *
 * @returns The npm spec to install.
 * @throws Never - reads an environment variable.
 * @typeParam None - this function has no generic type parameters.
 */
function nxGoPluginSpec (): string {
  return process.env.MNCI_NX_GO_SPEC ?? '@nx-go/nx-go'
}

/**
 * Ensures the `@nx-go/nx-go` Nx plugin is installed.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when the install exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
function ensureNxGoPlugin (workspaceRoot: string): void {
  if (hasPlugin(workspaceRoot, '@nx-go/nx-go')) {
    return
  }
  const spec = nxGoPluginSpec()
  logger.step(`Installing the Go toolchain plugin (${spec})`)
  if (
    runShell('npm', ['install', '--save-dev', spec, '--no-audit', '--no-fund'], workspaceRoot) !== 0
  ) {
    throw new Error('npm install of @nx-go/nx-go failed')
  }
}

/**
 * Idempotently bootstraps the workspace as a Go **multi-module** workspace (a root `go.work`).
 *
 * @remarks
 * Each Go project owns its `go.mod`, so it keeps its own dependencies — the same
 * per-project model mnci uses for every other language (#289). `init` writes the root
 * `go.work` and registers the plugin; each `@nx-go/nx-go:application`/`library` generator
 * then adds its own `go.mod` (module `<modulePrefix>/<projectDir>`, see
 * {@link registerNxGoPlugin}) and a `go.work` `use` entry. **No `convert-to-one-mod`** — that
 * is what used to force the single root module.
 *
 * Skipped when the workspace is already bootstrapped: a `go.work` (this layout), or a bare
 * root `go.mod` (a repository adopted while still single-module — left as-is until migrated).
 *
 * The old single-module choice avoided one failure: a stale `go.work` `use` entry (a project
 * dir removed by hand) makes `go list -m -json` fail and breaks the whole Nx graph. mnci now
 * **owns** `go.work` — the generators add entries, deletes remove them, and `mnci doctor`
 * fails on drift — so that failure cannot arise from a hand edit.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when the generator exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
function ensureGoModule (workspaceRoot: string): void {
  if (fileExists(join(workspaceRoot, 'go.work')) || fileExists(join(workspaceRoot, 'go.mod'))) {
    return
  }
  logger.step('Bootstrapping the Go workspace (go.work, one module per project)')
  runNx(['g', '@nx-go/nx-go:init', '--no-interactive'], workspaceRoot)
  // The plugin copies the developer's Go version into the go.work it has just written. Held to the ceiling HERE and
  // never again: once the file is the workspace's, its `go` line is theirs to raise, and later adds must not lower
  // it below what the modules in it need (#425).
  clampGoDirective(join(workspaceRoot, 'go.work'))
}

/**
 * The `module` line of a `go.mod`, or `undefined` when it is absent or unreadable.
 *
 * @param goModPath - Absolute path to a `go.mod`.
 * @returns The module path, or `undefined`.
 * @throws Never - an unreadable file yields `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
function readGoModModule (goModPath: string): string | undefined {
  try {
    // go.mod is not JSON, so it is read directly rather than via readJson.
    return /^module\s+(\S+)/m.exec(readFileSync(goModPath, 'utf8'))?.[1]
  } catch {
    return undefined
  }
}

/**
 * The Go import path of a project, for telling the user how to import a library just added.
 *
 * @remarks
 * Multi-module: the project has its own `go.mod` (module `<prefix>/<projectDir>`), so that is
 * the import base. Single-module / adopted (no per-project `go.mod`): compose the root
 * module with the project directory, which is how a package in one shared module is imported.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projectDir - The project's workspace-relative directory (e.g. `packages/core`).
 * @returns The import base path, or `undefined` when no module is resolvable.
 * @throws Never - returns `undefined` rather than propagating a read error.
 * @typeParam None - this function has no generic type parameters.
 */
function goModulePathFor (workspaceRoot: string, projectDir: string): string | undefined {
  const projectModule = readGoModModule(join(workspaceRoot, projectDir, 'go.mod'))
  if (projectModule !== undefined) {
    return projectModule
  }
  const rootModule = readGoModModule(join(workspaceRoot, 'go.mod'))

  return rootModule === undefined ? undefined : `${rootModule}/${projectDir}`
}

/**
 * Rewrites a freshly generated project's `go.mod` module path to `<modulePrefix>/<projectDir>`.
 *
 * @remarks
 * `@nx-go/nx-go` 4.1.1 names a workspace module after its directory alone (`apps/api`), which
 * is not a fetchable VCS path (its `modulePrefix` plugin option is honoured only by unreleased
 * versions). So mnci sets the path itself from the git origin ({@link goModulePrefix}), which
 * is what makes `go get <prefix>/libs/<name>` work and what {@link registerNxGoPlugin}'s option
 * records for a future plugin that reads it. No-op when there is no origin (keep the plugin's
 * default) or no per-project `go.mod` (a single-module/adopted workspace).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projectDir - The project's workspace-relative directory (e.g. `apps/api`).
 * @returns Nothing.
 * @throws Propagates an `fs` write error; a missing `go.mod` is a no-op, not a throw.
 * @typeParam None - this function has no generic type parameters.
 */
function setGoModulePath (workspaceRoot: string, projectDir: string): void {
  const prefix = goModulePrefix(workspaceRoot)
  const goModPath = join(workspaceRoot, projectDir, 'go.mod')
  if (prefix === undefined || !fileExists(goModPath)) {
    return
  }
  const rewritten = readFileSync(goModPath, 'utf8').replace(/^module\s+\S+/m, () => `module ${prefix}/${projectDir}`)
  writeFileEnsured(goModPath, rewritten)
}

/**
 * The `go` directive a generated module is held to, so CI's toolchain can always load it.
 *
 * @remarks
 * `@nx-go/nx-go` copies the **developer's** Go version into `go.mod`. CI's `golangci-lint` is built
 * with whatever Go its release was built with, and it refuses to load a module whose directive is
 * newer ("the Go language version used to build golangci-lint is lower than the targeted Go
 * version"), which fails every Go lint target on the first CI run - and only for a developer on
 * the newest Go, which is why it is missed locally (#348). The scaffold needs nothing newer, so the
 * directive is clamped and left for the developer to raise deliberately.
 */
export const GO_DIRECTIVE_CEILING = '1.24'

/** Whether a `1.x[.y]` Go version is newer than {@link GO_DIRECTIVE_CEILING}. */
function exceedsGoCeiling (version: string): boolean {
  const [major, minor] = version.split('.').map(Number)
  const [ceilingMajor, ceilingMinor] = GO_DIRECTIVE_CEILING.split('.').map(Number)

  return major > ceilingMajor || (major === ceilingMajor && minor > ceilingMinor)
}

/**
 * Clamps a `go.mod` or `go.work` `go` directive to {@link GO_DIRECTIVE_CEILING}, dropping a `toolchain` line.
 *
 * @param filePath - Absolute path to the `go.mod` or `go.work`.
 * @returns Nothing.
 * @throws Propagates an `fs` write error; a missing file is a no-op.
 * @typeParam None - this function has no generic type parameters.
 */
function clampGoDirective (filePath: string): void {
  if (!fileExists(filePath)) {
    return
  }
  const before = readFileSync(filePath, 'utf8')
  const directive = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(before)
  if (directive === null || !exceedsGoCeiling(directive[1])) {
    return
  }
  const after = before
    .replace(/^go\s+\d+\.\d+(?:\.\d+)?/m, () => `go ${GO_DIRECTIVE_CEILING}`)
    .replace(/^toolchain\s+\S+(?:\r?\n){1,2}/m, '')
  writeFileEnsured(filePath, after)
}

/**
 * Holds a freshly generated project to a `go` directive CI can load.
 *
 * @remarks
 * Only the new project's own `go.mod`. The workspace's `go.work` is clamped once, when mnci creates it, and is left
 * alone afterwards: a lower `go` line in a module inside a higher workspace is valid, whereas lowering the
 * workspace below a module that needs a newer Go breaks every build (#425).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projectDir - The project's workspace-relative directory.
 * @returns Nothing.
 * @throws Propagates an `fs` write error.
 * @typeParam None - this function has no generic type parameters.
 */
function pinGoDirective (workspaceRoot: string, projectDir: string): void {
  clampGoDirective(join(workspaceRoot, projectDir, 'go.mod'))
}

/**
 * Replaces the generator's root `Hello` with the worked example (a contract and a use case).
 *
 * @remarks
 * `@nx-go/nx-go:application` writes a `main.go` holding a `Hello` function and a `main_test.go`
 * testing it, all in the root `main` package. The example moves the behaviour into a `hello`
 * package behind `main.go`, which only wires. A no-op when the module path cannot be read.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projectDir - The app's directory relative to the workspace (`apps/<name>`).
 * @returns Nothing.
 * @throws Propagates any `fs` error writing or removing the files.
 * @typeParam None - this function has no generic type parameters.
 */
function writeGoAppExample (workspaceRoot: string, projectDir: string): void {
  const goModPath = join(workspaceRoot, projectDir, 'go.mod')
  const modulePath = fileExists(goModPath) ? /^module\s+(\S+)/m.exec(readFileSync(goModPath, 'utf8'))?.[1] : undefined
  if (modulePath === undefined) {
    return
  }
  rmSync(join(workspaceRoot, projectDir, 'main_test.go'), { force: true })
  const example = goAppExampleFiles(modulePath)
  for (const [relative, contents] of Object.entries(example)) {
    writeFileEnsured(join(workspaceRoot, projectDir, relative), contents)
  }
}

/**
 * The `test` target every Go project gets (`go test`).
 *
 * @returns The nx target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goTestTarget (): Record<string, unknown> {
  return { executor: '@nx-go/nx-go:test' }
}

/**
 * The `lint` target every Go project gets (`golangci-lint run`).
 *
 * @remarks
 * The executor's own default is `go fmt`, which only reformats — pinning
 * `linter` to `golangci-lint` is what makes this an actual linter.
 *
 * **`parallelism: false` is not a performance knob, it is a correctness fix.**
 * `golangci-lint` takes a machine-global lock and refuses to run beside another
 * copy of itself, exiting non-zero with `parallel golangci-lint is running`. Nx
 * runs `lint` across projects concurrently by default, so a workspace with two
 * or more Go projects failed `nx run-many -t lint` at random — one project
 * reporting `0 issues` while a sibling died on the lock. Nothing to do with the
 * Go code, and the failure moves between projects from run to run, which is what
 * makes it so unpleasant to diagnose from a CI log.
 *
 * Found the first time the e2e ever ran this assertion: `golangci-lint` had
 * never been installed on the runner, so the whole check reported SKIPPED and
 * this shipped unnoticed. Go lint is now serialised across projects; the other
 * targets are untouched and still run in parallel.
 *
 * @returns The nx target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goLintTarget (): Record<string, unknown> {
  return {
    executor:    '@nx-go/nx-go:lint',
    parallelism: false,
    options:     { linter: 'golangci-lint', args: ['run'] },
  }
}

/**
 * The `build` target for a Go executable (`go build`).
 *
 * @remarks
 * Builds to the workspace-root `dist/apps/<name>/` **directory**, with the
 * binary inside it, rather than to the executor's own default of a bare file
 * at `dist/apps/<name>`. That default cannot be declared as an Nx `outputs`
 * entry: Nx scans each declared output to cache it, and scanning a file
 * raises `ENOTDIR`. Building into a directory keeps the root-`dist`
 * convention, makes the output cacheable, and gives `package` a folder to
 * zip — verified end-to-end against a real workspace.
 *
 * `outputPath` is resolved relative to the executor's cwd (the project root),
 * hence the `../../` offset back to the workspace root.
 *
 * @param name - The project name, used for the project root in `outputs`.
 * @returns The nx target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goBuildTarget (name: string): Record<string, unknown> {
  return {
    executor: '@nx-go/nx-go:build',
    outputs:  [`{workspaceRoot}/dist/apps/${name}`],
    options:  { outputPath: `../../dist/apps/${name}/${name}` },
  }
}

/**
 * The `build-dev` target for a Go app: the binary with the optimiser and inlining off, for a debugger.
 *
 * @remarks
 * `-gcflags=all=-N -l` holds a space, so the flag is quoted INSIDE the command string: `nx:run-commands` hands the
 * string to a shell, which would otherwise split it and give `go build` a stray `-l` (measured, #230; `go version -m`
 * on the result shows the flag). It writes to `dist/dev/apps/<name>`, not beside {@link goBuildTarget}'s output, so
 * the two never overwrite each other and Nx restoring a cached `build` does not delete it.
 *
 * @param name - The Go app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goBuildDevTarget (name: string): Record<string, unknown> {
  return {
    executor: 'nx:run-commands',
    outputs:  [`{workspaceRoot}/dist/dev/apps/${name}`],
    options:  { command: `go build "-gcflags=all=-N -l" -o ../../dist/dev/apps/${name}/${name} .`, cwd: `apps/${name}` },
  }
}

/**
 * The `package` target for a Go app: zip its built binary into the drop.
 *
 * @remarks
 * Same cross-platform `adm-zip` one-liner used by every other packaged kind,
 * writing `dist/drop/<tag>-<name>.zip` — basename exactly `<tag>-<name>`,
 * the string CI turns into the per-app build tag. A Go binary is statically
 * linked, so unlike the Python kinds there is nothing else to inject.
 *
 * Zips the whole `dist/apps/<name>/` directory {@link goBuildTarget} writes,
 * so the same one-liner works whether the binary inside is `<name>` or
 * `<name>.exe` on a Windows agent.
 *
 * @param tag - The drop basename prefix (`go-app` or `go-function-app`).
 * @param name - The Go app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goPackageTarget (tag: string, name: string): Record<string, unknown> {
  const zip = `dist/drop/${tag}-${name}.zip`
  const command = `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFolder('dist/apps/${name}');z.writeZip('${zip}')"`

  return {
    executor:  'nx:run-commands',
    dependsOn: ['build'],
    outputs:   [`{workspaceRoot}/${zip}`],
    options:   { command },
  }
}

/**
 * The platforms a Go app is cross-compiled for by its `build-all` target.
 *
 * @remarks
 * Every desktop OS on both CPU families, the set an editor extension or a CLI that
 * ships its own binary has to cover. Go builds all of them from one machine without
 * cgo, which is why the targets below need no matrix of CI agents.
 */
export const GO_PLATFORMS = [
  'windows/amd64', 'windows/arm64', 'linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64',
] as const

/**
 * The `build-all` target for a Go app: one static binary per {@link GO_PLATFORMS}.
 *
 * @remarks
 * Writes `dist/platforms/<name>/<goos>-<goarch>/<name>[.exe]` with `CGO_ENABLED=0`,
 * `-trimpath` and `-ldflags "-s -w -X main.version=<VERSION>"`, `VERSION` coming from
 * the environment (`dev` when unset), so a release stamps its tag without editing
 * anything.
 *
 * Deliberately NOT under `dist/apps/<name>/`, though that is where `build` writes: Nx
 * clears a target's declared outputs before restoring them from cache, so a cached
 * `build` would delete the cross-compiled binaries nested inside its directory.
 *
 * `VERSION` is an input, so a release never reuses a binary stamped `dev`; the root
 * `go.mod`/`go.sum` are inputs because a dependency bump changes every binary.
 *
 * @param name - The Go app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goBuildAllTarget (name: string): Record<string, unknown> {
  const platforms = JSON.stringify(GO_PLATFORMS).replaceAll('"', "'")
  const command = `node -e "const{spawnSync}=require('node:child_process');const v=process.env.VERSION||'dev';for(const p of ${platforms}){const[os,arch]=p.split('/');const out='../../dist/platforms/${name}/'+os+'-'+arch+'/${name}'+(os==='windows'?'.exe':'');const r=spawnSync('go',['build','-trimpath','-ldflags','-s -w -X main.version='+v,'-o',out,'.'],{cwd:'apps/${name}',stdio:'inherit',env:{...process.env,CGO_ENABLED:'0',GOOS:os,GOARCH:arch}});if(r.status!==0)process.exit(r.status??1)}"`

  return {
    executor: 'nx:run-commands',
    inputs:   ['default', '^default', '{workspaceRoot}/go.mod', '{workspaceRoot}/go.sum', { env: 'VERSION' }],
    outputs:  [`{workspaceRoot}/dist/platforms/${name}`],
    options:  { command },
  }
}

/**
 * The `package-all` target for a Go app: one zip per platform {@link goBuildAllTarget}
 * built.
 *
 * @remarks
 * `dist/drop/<tag>-<name>-<goos>-<goarch>.zip`, each holding that platform's binary,
 * the same `adm-zip` one-liner as {@link goPackageTarget}. The single-platform
 * `package` target keeps its name, so CI's drop handling is unchanged.
 *
 * @param tag - The drop basename prefix (`go-app` or `go-function-app`).
 * @param name - The Go app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goPackageAllTarget (tag: string, name: string): Record<string, unknown> {
  const command = `node -e "const fs=require('node:fs');const A=require('adm-zip');fs.mkdirSync('dist/drop',{recursive:true});for(const d of fs.readdirSync('dist/platforms/${name}')){const z=new A();z.addLocalFolder('dist/platforms/${name}/'+d);z.writeZip('dist/drop/${tag}-${name}-'+d+'.zip')}"`

  return {
    executor:  'nx:run-commands',
    dependsOn: ['build-all'],
    outputs:   [`{workspaceRoot}/dist/drop/${tag}-${name}-*.zip`],
    options:   { command },
  }
}

/**
 * The shell fragment that asks Go for this machine's `GOOS` and `GOARCH`.
 *
 * @remarks
 * Two calls rather than one `go env GOOS GOARCH`, so there is no newline to split on:
 * these commands pass through `cmd.exe` and POSIX `sh`, and a backslash is where they
 * disagree.
 */
const GO_HOST_PLATFORM = "const host=k=>spawnSync('go',['env',k],{encoding:'utf8'}).stdout.trim();const os=host('GOOS'),arch=host('GOARCH');"

/**
 * The `build-native` target of an app that needs a C toolchain: one binary, for this machine.
 *
 * @remarks
 * What {@link goBuildAllTarget} cannot do: with `CGO_ENABLED=1` the binary can only be
 * built where the C toolchain and the target OS's libraries are, so there is no cross-
 * compile, and CI runs this on a runner of each OS. The output path, the `VERSION`
 * stamp (`dev` when unset) and `-trimpath` are the same as `build-all`'s, so a platform's
 * binary sits where `package-all` would have put it and a release stamps it the same way.
 *
 * Named `build-native`, not `build`, so the generic verify, which runs `build` on one
 * agent, never reaches it.
 *
 * @param name - The Go app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goNativeBuildTarget (name: string): Record<string, unknown> {
  const command = `node -e "const{spawnSync}=require('node:child_process');${GO_HOST_PLATFORM}const v=process.env.VERSION||'dev';const out='../../dist/platforms/${name}/'+os+'-'+arch+'/${name}'+(os==='windows'?'.exe':'');const r=spawnSync('go',['build','-trimpath','-ldflags','-s -w -X main.version='+v,'-o',out,'.'],{cwd:'apps/${name}',stdio:'inherit',env:{...process.env,CGO_ENABLED:'1'}});process.exit(r.status??1)"`

  return {
    executor: 'nx:run-commands',
    inputs:   ['default', '^default', '{workspaceRoot}/go.mod', '{workspaceRoot}/go.sum', { env: 'VERSION' }],
    outputs:  [`{workspaceRoot}/dist/platforms/${name}`],
    options:  { command },
  }
}

/**
 * The `package-native` target of an app that needs a C toolchain: this machine's zip.
 *
 * @remarks
 * `dist/drop/go-app-<name>-<goos>-<goarch>.zip`, the name `package-all` gives each
 * platform's zip, so a release attaches the legs' zips the way it attaches the six.
 *
 * @param name - The Go app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goNativePackageTarget (name: string): Record<string, unknown> {
  const command = `node -e "const fs=require('node:fs');const{spawnSync}=require('node:child_process');const A=require('adm-zip');${GO_HOST_PLATFORM}const d=os+'-'+arch;fs.mkdirSync('dist/drop',{recursive:true});const z=new A();z.addLocalFolder('dist/platforms/${name}/'+d);z.writeZip('dist/drop/go-app-${name}-'+d+'.zip')"`

  return {
    executor:  'nx:run-commands',
    dependsOn: ['build-native'],
    outputs:   [`{workspaceRoot}/dist/drop/go-app-${name}-*.zip`],
    options:   { command },
  }
}

/**
 * Gives every Go app in the workspace its `build-all` and `package-all` targets when it
 * lacks them: the `mnci upgrade` path for apps added before the targets existed.
 *
 * @remarks
 * Only adds; a target the user already has, under either name, is never touched.
 * Idempotent, so a repeat upgrade is a no-op. An app that needs a C toolchain is
 * skipped: it cannot be cross-compiled, and a `build-all` that silently built it
 * without cgo would ship a binary missing the very thing it exists for.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The `project.json` files it changed, workspace-relative.
 * @throws Error when a Go app's `project.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGoPlatformTargets (workspaceRoot: string): string[] {
  const changed: string[] = []
  const apps = join(workspaceRoot, 'apps')
  if (!fileExists(apps)) {
    return changed
  }
  for (const name of readdirSync(apps)) {
    const projectJsonPath = join(apps, name, 'project.json')
    if (!fileExists(projectJsonPath)) {
      continue
    }
    const project = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as { tags?: string[], targets?: Record<string, unknown> }
    const tag = (project.tags ?? []).find(each => each === 'type:go-app' || each === 'type:go-function-app')?.slice('type:'.length)
    if (tag === undefined) {
      continue
    }
    const missing: Record<string, unknown> = {}
    if (tag === 'go-app' && project.targets?.['build-dev'] === undefined) {
      missing['build-dev'] = goBuildDevTarget(name)
    }
    if ((project.tags ?? []).includes(GO_CGO_TAG)) {
      if (Object.keys(missing).length > 0) {
        addProjectJsonTargets(projectJsonPath, missing)
        changed.push(`apps/${name}/project.json`)
      }
      continue
    }
    if (project.targets?.['build-all'] === undefined) {
      missing['build-all'] = goBuildAllTarget(name)
    }
    if (project.targets?.['package-all'] === undefined) {
      missing['package-all'] = goPackageAllTarget(tag, name)
    }
    if (Object.keys(missing).length > 0) {
      addProjectJsonTargets(projectJsonPath, missing)
      changed.push(`apps/${name}/project.json`)
    }
  }

  return changed
}

/**
 * The `start` target for a Go app: `go run .`, locally.
 *
 * @remarks
 * `go run` compiles and runs from source in one step — unlike
 * {@link goBuildTarget}, no separate build/`dependsOn` is needed.
 * `continuous: true` marks it as a long-running dev task, the same shape
 * every other kind's custom `start` target uses.
 *
 * @param name - The Go app's project name.
 * @returns The nx:run-commands target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goStartTarget (name: string): Record<string, unknown> {
  return {
    executor:   'nx:run-commands',
    continuous: true,
    options:    { command: 'go run .', cwd: `apps/${name}` },
  }
}

/**
 * The Go identifiers `@nx-go/nx-go:library` derives from a project name.
 *
 * @remarks
 * Matches the plugin's own `normalizeOptions` for hyphenated names: the
 * package clause is `names(projectName).propertyName.toLowerCase()` and the
 * sample function is `names(projectName).className`. Re-derived here rather
 * than imported because `@nx/devkit` is not a runtime dependency of the CLI.
 * Project names are validated to lowercase letters, digits, `-` and `.`
 * (`project-name.validator.ts`), and splitting on every non-alphanumeric
 * character also covers the dotted names the plugin leaves as an invalid
 * package clause (`my.lib` → `mylib`, not `my.lib`).
 *
 * `fileStem` is the snake-case form used for the role-suffixed file names
 * (`markdown-workspace` → `markdown_workspace`), the Go spelling of the
 * `<kebab>.<role>.ts` convention.
 *
 * @param projectName - The validated project name.
 * @returns The package name, the exported function name and the file stem.
 * @throws Never - pure string computation.
 * @typeParam None - this function has no generic type parameters.
 */
export function goLibraryIdentifiers (projectName: string): {
  packageName:  string
  functionName: string
  fileStem:     string
} {
  const words = projectName.split(/[^a-z0-9]+/i).filter(word => word.length > 0)

  return {
    packageName:  words.join('').toLowerCase(),
    functionName: words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(''),
    fileStem:     words.join('_').toLowerCase(),
  }
}

/**
 * Reshapes a freshly generated Go library into a capability with one slice.
 *
 * @remarks
 * `@nx-go/nx-go:library` writes `<projectName>.go` and `<projectName>_test.go`
 * at the project root, so the root package IS the library. That contradicts
 * the vertical-slice shape mnci follows everywhere else (capability → flat
 * slice → role-suffixed files, with only an entry point at the root), and a
 * library that grows from it grows as one flat package that never splits.
 * Found while bootstrapping Lore Master, whose three Go libraries are each
 * several slice packages (MoNecromanCI/MoNecromanCi#227).
 *
 * After this runs, the root holds only `doc.go` (the capability's package
 * comment) and the generator's sample code lives in one starter slice:
 *
 * ```
 * libs/markdown-workspace/
 * ├── doc.go                                   package markdownworkspace
 * ├── project.json
 * └── markdownworkspace/
 *     ├── doc.go
 *     ├── markdown_workspace_use_case.go       func MarkdownWorkspace(name string) string
 *     └── markdown_workspace_use_case_test.go
 * ```
 *
 * `use_case` is the role for the same reason the TypeScript placeholder is
 * renamed to `.use-case.ts` (`renameScaffoldPlaceholder`): it is the generic
 * role for a library's public behaviour. Unconditional for the same reason
 * too — whether a workspace "uses" slices is not knowable from the files, and
 * the shape costs nothing when ignored.
 *
 * The project's `test` and `lint` targets need no change: the plugin's
 * executors run `go test ./...` and `<linter> run ./...` from the project
 * root, so the slice package below it is covered (MoNecromanCI/MoNecromanCi#233).
 *
 * Idempotent: the root placeholders are removed with `force`, and the slice
 * files are only written when absent, so a user's edits survive a re-run.
 *
 * @param projectRoot - Absolute path to the generated library.
 * @param projectName - The project name the generator used for its files.
 * @returns The import path suffix of the starter slice, relative to the module.
 * @throws Propagates any `fs` error writing the new files.
 * @typeParam None - this function has no generic type parameters.
 */
export function reshapeGoLibraryScaffold (projectRoot: string, projectName: string): string {
  const { packageName, fileStem } = goLibraryIdentifiers(projectName)

  rmSync(join(projectRoot, `${projectName}.go`), { force: true })
  rmSync(join(projectRoot, `${projectName}_test.go`), { force: true })

  const files: ReadonlyArray<readonly [string, string]> = [
    [
      'doc.go',
      `// Package ${packageName} is the ${projectName} capability. Its code lives in the\n` +
        '// slice packages below this directory, one package per outcome.\n' +
        `package ${packageName}\n`,
    ],
    [
      join(packageName, 'doc.go'),
      `// Package ${packageName} is the starter slice of ${projectName}: rename it after\n` +
        '// the outcome it delivers, and add one package per further outcome.\n' +
        `package ${packageName}\n`,
    ],
    // The starter slice: a contract, a use case and its test (see goLibraryExampleFiles).
    ...Object.entries(goLibraryExampleFiles(packageName, fileStem)).map(
      ([name, content]): readonly [string, string] => [join(packageName, name), content],
    ),
  ]
  for (const [relativePath, content] of files) {
    const path = join(projectRoot, relativePath)
    if (!fileExists(path)) {
      writeFileEnsured(path, content)
    }
  }

  return packageName
}

/**
 * Shared preflight for every Go kind: toolchain, plugin, root module and the plugin's registration.
 *
 * @remarks
 * The registration is its own step, after the module, because the bootstrap that used to do
 * it is skipped when a `go.mod` already exists (an adopted flat Go module), which left Nx
 * with no Go project graph and `affected` silently wrong. It is a no-op when the bootstrap
 * ran, since `init` registered the plugin.
 */
function prepareGo (workspaceRoot: string): void {
  ensureGo(workspaceRoot)
  warnIfNoGolangciLint(workspaceRoot)
  ensureNxGoPlugin(workspaceRoot)
  ensureGoModule(workspaceRoot)
  if (registerNxGoPlugin(workspaceRoot)) {
    logger.step('Registering the Go plugin in nx.json, so Nx can see which Go project imports which')
  }
}

/**
 * Adds a Go executable app under `apps/`.
 *
 * @remarks
 * Delegates project generation to `@nx-go/nx-go:application`, then writes the
 * build/test/lint targets explicitly (which override the plugin's inferred ones — mnci
 * pins lint to golangci-lint, not the plugin's `go fmt` default) plus mnci's own `package`
 * zip convention. With `release`, the app also joins
 * `nx release` (see {@link makeGoAppReleasable}); without it, it is never released.
 *
 * With `cgo`, the app needs a C toolchain (a tray icon, a native GUI, a cgo
 * database driver), so it cannot be cross-compiled from one machine. It is tagged
 * {@link GO_CGO_TAG} and gets `build-native` and `package-native`, for the machine
 * they run on, instead of `package`, `build-all` and `package-all`: the single-agent
 * pack step would otherwise try to build it on a runner that lacks its libraries.
 * CI builds it on a runner of every OS (the pipelines gain a `native` job on the next
 * `mnci upgrade`).
 *
 * With `web`, the app embeds and serves the React app of that name (see
 * {@link wireGoAppToWeb}), which has to exist already.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param options - `release`: release the app, versioned from its git tag. `cgo`: it needs a C toolchain. `web`: the React app it serves.
 * @returns Nothing.
 * @throws Error when Go is missing, `web` is not a React app, or the generator/install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGoApp (workspaceRoot: string, name: string, options: { release?: boolean, cgo?: boolean, web?: string } = {}): void {
  const cgo = options.cgo === true
  // Before anything is generated or installed, like the toolchain probe below it.
  if (options.web !== undefined) {
    assertWebApp(workspaceRoot, options.web)
  }
  prepareGo(workspaceRoot)
  ensureAdmZip(workspaceRoot)

  runNx(
    [
      'g',
      '@nx-go/nx-go:application',
      `apps/${name}`,
      `--name=${name}`,
      cgo ? `--tags=type:go-app,${GO_CGO_TAG}` : '--tags=type:go-app',
      '--no-interactive',
    ],
    workspaceRoot,
  )
  setGoModulePath(workspaceRoot, `apps/${name}`)
  pinGoDirective(workspaceRoot, `apps/${name}`)
  // `--web` replaces main.go with its own server, so the example would be an orphan there.
  if (options.web === undefined) {
    writeGoAppExample(workspaceRoot, `apps/${name}`)
  }
  addProjectJsonTargets(join(workspaceRoot, 'apps', name, 'project.json'), {
    'build': goBuildTarget(name),
    'test':  goTestTarget(),
    'lint':  goLintTarget(),
    ...(cgo
      ? { 'build-native': goNativeBuildTarget(name), 'package-native': goNativePackageTarget(name) }
      : {
          'package':     goPackageTarget('go-app', name),
          'build-all':   goBuildAllTarget(name),
          'package-all': goPackageAllTarget('go-app', name),
        }),
    'build-dev': goBuildDevTarget(name),
    'start':     goStartTarget(name),
  })
  if (options.release === true) {
    makeGoAppReleasable(workspaceRoot, name)
  }
  if (options.web !== undefined) {
    wireGoAppToWeb(workspaceRoot, name, options.web)
  }
  registerProjectCommands(workspaceRoot, name, {
    build:    true,
    start:    `nx run ${name}:start`,
    buildDev: `nx run ${name}:build-dev`,
  })
  if (cgo) {
    logger.warn(
      `${name} needs a C toolchain, so CI builds it on a runner of each OS. Run \`mnci upgrade\` to add the native job to your pipeline, and add the -dev packages it links to the Linux prerequisites step.`,
    )
  }
}

/**
 * Adds a Go serverless function app under `apps/`.
 *
 * @remarks
 * Structurally the same as {@link addGoApp} — a Go function app is an
 * ordinary executable whose `main` is the platform's handler entry point —
 * so this shares the generator and targets, differing only in its tag and
 * its drop basename (`go-function-app-<name>`). The handler body itself is
 * left to the user: AWS Lambda, Google Cloud Functions and Azure each want a
 * different signature, and mnci does not pick one for you.
 *
 * No `start` target, unlike `node-function-app`/`python-function-app`:
 * `func start` needs a `host.json` (and, for the custom-handler model Go
 * would use, a matching `customHandler` config), and this kind writes
 * neither — an honest known gap, not an oversight papered over with a
 * command that would just fail. `go-app`'s `go run .` doesn't apply either,
 * since there is no Functions host to dispatch triggers to it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @returns Nothing.
 * @throws Error when Go is missing, or the generator/install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGoFunctionApp (workspaceRoot: string, name: string): void {
  prepareGo(workspaceRoot)
  ensureAdmZip(workspaceRoot)

  runNx(
    [
      'g',
      '@nx-go/nx-go:application',
      `apps/${name}`,
      `--name=${name}`,
      '--tags=type:go-function-app',
      '--no-interactive',
    ],
    workspaceRoot,
  )
  setGoModulePath(workspaceRoot, `apps/${name}`)
  pinGoDirective(workspaceRoot, `apps/${name}`)
  writeGoAppExample(workspaceRoot, `apps/${name}`)
  addProjectJsonTargets(join(workspaceRoot, 'apps', name, 'project.json'), {
    'build':       goBuildTarget(name),
    'test':        goTestTarget(),
    'lint':        goLintTarget(),
    'package':     goPackageTarget('go-function-app', name),
    'build-all':   goBuildAllTarget(name),
    'package-all': goPackageAllTarget('go-function-app', name),
  })
  registerProjectCommands(workspaceRoot, name, { build: true })
}

/**
 * Adds a publishable Go library under `packages/`.
 *
 * @remarks
 * "Publishable" means something different in Go than in npm or PyPI, and it
 * is worth being precise: there is no registry upload step. The whole
 * repository is one module, so consumers depend on this library by its
 * import path at a repo-level version tag —
 * `go get <module>/packages/<name>@v1.2.3`. Publishing is therefore the git
 * tag `nx release` already creates; no `nx-release-publish` target is
 * written, because there is nothing to push. The only real difference from
 * an internal library is intent, recorded in the `type:go-lib` tag and the
 * `packages/` location.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @returns Nothing.
 * @throws Error when Go is missing, or the generator/install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGoLib (workspaceRoot: string, name: string): void {
  prepareGo(workspaceRoot)

  runNx(
    [
      'g',
      '@nx-go/nx-go:library',
      `packages/${name}`,
      `--name=${name}`,
      '--tags=type:go-lib',
      '--no-interactive',
    ],
    workspaceRoot,
  )
  setGoModulePath(workspaceRoot, `packages/${name}`)
  pinGoDirective(workspaceRoot, `packages/${name}`)
  addProjectJsonTargets(join(workspaceRoot, 'packages', name, 'project.json'), {
    test: goTestTarget(),
    lint: goLintTarget(),
  })
  const slice = reshapeGoLibraryScaffold(join(workspaceRoot, 'packages', name), name)
  registerProjectCommands(workspaceRoot, name, { build: false })

  const module = goModulePathFor(workspaceRoot, `packages/${name}`)
  if (module) {
    logger.step(`Import its starter slice as ${module}/${slice}`)
  }
}

/**
 * Adds a private Go library under `libs/`.
 *
 * @remarks
 * Identical machinery to {@link addGoLib} minus the publishable intent: its own module
 * under `libs/<name>`, imported by its module path. Test and lint
 * targets only — a Go package that is not `main` produces no binary, so
 * there is no build target to write.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @returns Nothing.
 * @throws Error when Go is missing, or the generator/install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGoInternalLib (workspaceRoot: string, name: string): void {
  prepareGo(workspaceRoot)

  runNx(
    [
      'g',
      '@nx-go/nx-go:library',
      `libs/${name}`,
      `--name=${name}`,
      '--tags=type:go-internal-lib',
      '--no-interactive',
    ],
    workspaceRoot,
  )
  setGoModulePath(workspaceRoot, `libs/${name}`)
  pinGoDirective(workspaceRoot, `libs/${name}`)
  addProjectJsonTargets(join(workspaceRoot, 'libs', name, 'project.json'), {
    test: goTestTarget(),
    lint: goLintTarget(),
  })
  const slice = reshapeGoLibraryScaffold(join(workspaceRoot, 'libs', name), name)
  registerProjectCommands(workspaceRoot, name, { build: false })

  const module = goModulePathFor(workspaceRoot, `libs/${name}`)
  if (module) {
    logger.step(`Import its starter slice as ${module}/${slice}`)
  }
}
