import { join } from 'node:path'
import { select } from '@inquirer/prompts'
import { runFormatter, runNx } from '../nx-workspace'
import { promptText } from '../terminal'
import { fileExists, readJson } from '../file-system'
import { logger } from '../terminal'
import { assertValidProjectName } from '../project-name'
import { addCsharpApp, addCsharpFunctionApp, addCsharpInternalLib, addCsharpLib } from './csharp.use-case'
import { addFlutterApp, addFlutterInternalLib, addFlutterLib } from './flutter.use-case'
import { addGoApp, addGoFunctionApp, addGoInternalLib, addGoLib } from './go.use-case'
import { addNodeApp, addNodeFunctionApp } from './node.use-case'
import { addNpmLib } from './npm-lib.use-case'
import {
  addPythonApp,
  addPythonFunctionApp,
  addPythonInternalLib,
  addPythonLib,
  addPythonVendor,
} from './python.use-case'
import { addContainer } from './container.use-case'
import { addAngularApp } from './angular-app.use-case'
import { addBicepProject } from './bicep.use-case'
import { addDocsSite } from './docs-site.use-case'
import { addSvelteApp } from './svelte-app.use-case'
import { addVueApp } from './vue-app.use-case'
import { addReactApp } from './react-app.use-case'
import { addReactInternalLib, addReactLib } from './react-lib.use-case'
import { addVscodeExtension } from './vscode-extension.use-case'
import { syncProjectReferences } from '../dependency-management'
import { readMnciConfig } from '../workspace-overlay'
import { completeLockfile } from '../lockfile-completion'
import {
  ensureNxPeerOverrides,
  markPrivate,
  renameScaffoldPlaceholder,
  registerProjectCommands,
  relocateRootRuntimeDependencies,
  removeGeneratedEslintConfig,
  rootRuntimeDependencies,
  type AddOptions,
  type WorkspaceStack,
} from './post-generation.use-case'

export type { AddOptions } from './post-generation.use-case'

/**
 * The project kinds this CLI can add — deliberately just twenty-three.
 *
 * @remarks
 * Each maps to an official (or established first-party) Nx plugin generator;
 * this CLI itself writes no project files (bar thin overlays). Layout convention
 * drives release scoping: `apps/` (never released, except a `vscode-extension`,
 * matched by its tag), `packages/` (publishable
 * npm, released by `nx release`), `libs/` (internal, never released),
 * `python-packages/` (publishable Python, published by `twine`).
 *
 * The TS/JS kinds use the official `@nx/*` generators only — `node-app` and
 * `node-function-app` are both the plain `@nx/node:application` (no
 * third-party Azure Functions plugin; `node-function-app` is that generator
 * plus a hand-written Azure Functions v4 file overlay). The Python kinds use
 * **`@mnci/nx-python-pip`** (`libs/nx-python-pip` in this same monorepo) — a
 * real Nx plugin this project built and maintains, since no maintained
 * Nx-23-compatible plugin supports pip (every one found ships uv/Poetry
 * only). Its generators write `pyproject.toml` + `project.json` + a sample
 * module/tests around **pip + Ruff + pytest + the standard PyPA
 * `build`/`twine`** — the industry-standard, uv-free Python toolchain — and
 * follow the identical app/function-app split. Every kind builds to its own
 * Nx-default output location — no post-generation build-output redirection.
 * Each kind's generation logic lives in its own module under `add/` — see
 * `add/reactApp.ts`, `add/reactLib.ts`, `add/node.ts`, `add/npmLib.ts` and
 * `add/python.ts` (internal-lib is small enough to stay inline below).
 *
 * The React family covers all three shapes: `react-app` (Vite SPA),
 * `react-lib` (publishable component library) and `react-internal-lib`
 * (private). The two library kinds were missing for a long time, which meant a
 * shared component library could not be built at all — `npm-lib` and
 * `internal-lib` are both `@nx/js:lib`, with no JSX support.
 *
 * The Go kinds use **`@nx-go/nx-go`** — an established third-party plugin,
 * validated empirically against a real Nx 23.1.0 workspace (it declares
 * `@nx/devkit ">= 20 < 23"` as a plain dependency, so npm nests its own
 * devkit copy and everything still works). Go follows the same
 * root-manifest model as TS and Python: `add/go.ts` bootstraps a **single
 * root `go.mod`** on the first Go add (via the plugin's `init` +
 * `convert-to-one-mod`), so every Go project shares one module and a library
 * is imported as `<module>/libs/<name>` — no per-project manifests, no
 * `replace` directives. Because that single-module layout has no per-project
 * `go.mod`, the plugin's inference produces no targets, so mnci writes
 * build/test/lint explicitly (as it does for most kinds anyway). Lint is
 * `golangci-lint` — the executor's own default is plain `go fmt`, which only
 * reformats. Go needs no publish-time dependency injection at all: `go build`
 * links statically.
 *
 * The Flutter kinds use **`@mnci/nx-flutter`** (`packages/nx-flutter` in this
 * same monorepo) — the second real Nx plugin this project builds and
 * maintains, for the same reason as the Python one: no maintained,
 * Nx-23-compatible Flutter plugin exists (`@nxrocks/nx-flutter` cannot even
 * load on Nx 23 — it imports `@nx/workspace/src/utilities/fileutils`, removed
 * in 23). Its generators delegate scaffolding to the official Flutter CLI
 * (`flutter create`), so no template is hand-maintained against SDK releases.
 *
 * Flutter follows the same root-manifest model as the rest: a **Dart pub
 * workspace**, with one root `pubspec.yaml` listing every project and each
 * project carrying `resolution: workspace`, so a single `flutter pub get` at
 * the root resolves the whole graph into one `pubspec.lock`. The payoff is
 * that a project depending on an internal lib declares a **plain version
 * constraint with no `path:`** — pub resolves it locally because it is a
 * workspace member. That is also why Flutter needs no vendoring step (unlike
 * `python-vendor` below): there is nothing to weave in at build time. Apps
 * build for **web** only, which keeps the Android SDK off every build agent.
 *
 * `vscode-extension` is `@nx/node:application` turned into a Marketplace
 * extension: bundled with `vscode` external, packaged by `vsce` into one `.vsix`
 * (or one per platform with a `--sidecar` Go app's binaries in it), published by
 * `nx release` when `VSCE_PAT` is set. It lives in `apps/` and is released anyway,
 * through the `type:vscode-extension` tag in `release.projects`.
 *
 * `python-vendor` is the one kind that generates nothing: plain pip has no
 * bundled-local-dependency feature, so wiring an internal Python library
 * into a consumer's built wheel is a hand-edit of the consumer's
 * `pyproject.toml` (see `@mnci/nx-python-pip`'s README) — this kind
 * automates exactly that edit, idempotently, instead of delegating to a
 * generator. `name` is the consumer; the library is `--lib <name>`.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type ProjectKind =
  | 'react-app' |
  'angular-app' |
  'vue-app' |
  'svelte-app' |
  'bicep-iac' |
  'docs-site' |
  'react-lib' |
  'react-internal-lib' |
  'node-app' |
  'node-function-app' |
  'npm-lib' |
  'internal-lib' |
  'python-app' |
  'python-function-app' |
  'python-lib' |
  'python-internal-lib' |
  'python-vendor' |
  'go-app' |
  'go-function-app' |
  'go-lib' |
  'go-internal-lib' |
  'flutter-app' |
  'flutter-lib' |
  'flutter-internal-lib' |
  'csharp-app' |
  'csharp-function-app' |
  'csharp-lib' |
  'csharp-internal-lib' |
  'vscode-extension' |
  'container'

/**
 * Every kind {@link runAdd} accepts, in menu order.
 *
 * @remarks
 * Also drives the interactive kind picker shown when `add` is run bare. The
 * React family first, then the rest of the TS/JS kinds, then Python, Go,
 * Flutter and C#.
 */
export const PROJECT_KINDS: ProjectKind[] = [
  'react-app',
  'angular-app',
  'vue-app',
  'svelte-app',
  'react-lib',
  'react-internal-lib',
  'node-app',
  'node-function-app',
  'npm-lib',
  'internal-lib',
  'python-app',
  'python-function-app',
  'python-lib',
  'python-internal-lib',
  'python-vendor',
  'go-app',
  'go-function-app',
  'go-lib',
  'go-internal-lib',
  'flutter-app',
  'flutter-lib',
  'flutter-internal-lib',
  'csharp-app',
  'csharp-function-app',
  'csharp-lib',
  'csharp-internal-lib',
  'vscode-extension',
  'container',
  'bicep-iac',
  'docs-site',
]

/** The kinds that can scaffold a bare slice skeleton (`--empty`). More join as their samples are reshaped. */
const EMPTY_KINDS: ReadonlySet<string> = new Set(['npm-lib', 'internal-lib', 'react-lib', 'react-internal-lib', 'node-function-app', 'react-app', 'angular-app', 'vue-app', 'svelte-app', 'bicep-iac', 'node-app', 'go-app', 'go-function-app', 'go-lib', 'go-internal-lib', 'python-app', 'python-function-app', 'python-lib', 'python-internal-lib', 'flutter-app', 'flutter-lib', 'flutter-internal-lib', 'csharp-app', 'csharp-function-app', 'csharp-lib', 'csharp-internal-lib'])

/** The kinds a registry publishes: a workspace with no registry releases none of them. */
const PUBLISHABLE_KINDS: ReadonlySet<ProjectKind> = new Set<ProjectKind>(['npm-lib', 'react-lib', 'python-lib', 'csharp-lib', 'flutter-lib'])

/**
 * Adds a project to the workspace by delegating to the matching Nx generator.
 *
 * @remarks
 * A thin dispatcher — the actual generation logic for each kind lives in its
 * own module under `add/` (imported above), so this function only resolves
 * the shared inputs (kind, name, the workspace's stack) and routes to the
 * right one. Pure delegation throughout — no post-generation file rewriting
 * beyond each kind's own thin overlay. Known gap: a *publishable* lib
 * importing a *private internal* lib cannot be published as-is; internal
 * libs are for apps and other internal libs.
 *
 * @param kind - The project kind, prompted for when omitted.
 * @param name - The project name, prompted for when omitted.
 * @param options - The CLI flags.
 * @returns A promise that resolves when the generator has finished.
 * @throws Error when run outside a workspace root or a generator fails.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runAdd (
  kind: ProjectKind | undefined,
  name: string | undefined,
  options: AddOptions,
): Promise<void> {
  const workspaceRoot = process.cwd()
  if (!fileExists(join(workspaceRoot, 'nx.json'))) {
    throw new Error('No nx.json found here. Run `add` from the workspace root.')
  }

  // The stack chosen at `mnci new` lives in nx.json; every generator (and the
  // hand-built function app) is wired to match it.
  const stack = readWorkspaceStack(workspaceRoot)

  // When the kind was not passed, the user is on the bare/interactive path, so
  // fill in every configuration — including the npm-lib scope (below) that the
  // flag path defaults silently.
  const kindProvided = kind !== undefined
  const resolvedKind =
    kind ??
    (await select<ProjectKind>({
      message: 'What kind of project?',
      choices: PROJECT_KINDS.map(value => ({ name: value, value })),
    }))
  // Not silently ignored like the other kind-specific options: a user who asked for
  // a release (or a native build) would otherwise believe the project has one.
  for (const [flag, requested] of [
    ['--release', options.release === true],
    ['--cgo', options.cgo === true],
    ['--web', options.web !== undefined],
  ] as const) {
    if (resolvedKind !== 'go-app' && requested) {
      throw new Error(`${flag} applies to go-app only, not ${resolvedKind}.`)
    }
  }
  if (options.empty === true && !EMPTY_KINDS.has(resolvedKind)) {
    throw new Error(`--empty applies to ${[...EMPTY_KINDS].join(', ')}, not ${resolvedKind}.`)
  }
  if (resolvedKind === 'node-app' && options.empty === true && (options.framework === 'fastify' || options.framework === 'nest')) {
    throw new Error(`--empty is not supported with --framework ${options.framework}: its layout (autoloaded routes, controllers and modules) is mandated by the framework, so there is no bare variant. Use express, koa or none.`)
  }
  if (options.empty === true && options.web !== undefined) {
    throw new Error('--empty and --web cannot be combined: --web writes the app\'s main.go and the embedded page itself.')
  }
  if (options.esm === true) {
    if (resolvedKind !== 'node-app' && resolvedKind !== 'node-function-app') {
      throw new Error(`--esm applies to node-app and node-function-app, not ${resolvedKind}.`)
    }
    if (options.framework === 'fastify' || options.framework === 'nest') {
      throw new Error(`--esm is not supported with --framework ${options.framework}: its layout (autoloaded routes, decorators) is mandated by the framework. Use express, koa or none.`)
    }
  }
  if (resolvedKind === 'container' && options.app === undefined) {
    throw new Error('container needs --app <project>: the app to put in an image, for example `mnci add container api-image --app api`.')
  }
  for (const [flag, requested] of [['--app', options.app !== undefined], ['--port', options.port !== undefined]] as const) {
    if (resolvedKind !== 'container' && requested) {
      throw new Error(`${flag} applies to container, not ${resolvedKind}.`)
    }
  }
  if (options.port !== undefined && !/^\d+$/.test(options.port)) {
    throw new Error(`--port ${options.port}: a port is a whole number.`)
  }
  if (resolvedKind !== 'react-app' && resolvedKind !== 'angular-app' && options.e2e === true) {
    throw new Error(`--e2e applies to react-app and angular-app, not ${resolvedKind}.`)
  }
  const resolvedName = name ?? (await promptText('Project name'))
  // A workspace generated with --registry none releases only what is tagged for it, so a library added to it is never
  // published: say so rather than let it look like one is (#228).
  if (PUBLISHABLE_KINDS.has(resolvedKind) && readMnciConfig(workspaceRoot).registry?.kind === 'none') {
    logger.warn(`This workspace has no package registry (--registry none), so ${resolvedName} will not be released. Run \`mnci upgrade --registry npm\` (or azure-artifacts) to publish it.`)
  }
  // Fails fast, before any install or generator call: the name becomes a
  // directory, an argv token and (for Python kinds) a module identifier — and
  // an explicitly empty `name` argument bypasses promptText's own non-empty
  // check, which only fires on the prompted path.
  assertValidProjectName(resolvedName, 'Project name')

  // Snapshotted before any generator runs, so whatever appears in the root's
  // runtime dependencies afterwards can be attributed to this project and moved
  // into its own manifest. See relocateRootRuntimeDependencies for why the root
  // is the wrong place for one.
  const rootDependenciesBefore = rootRuntimeDependencies(workspaceRoot)

  // Before the switch, because every generator below installs as it scaffolds
  // and the override has to already be on disk when it does. See
  // ensureNxPeerOverrides.
  ensureNxPeerOverrides(workspaceRoot)

  switch (resolvedKind) {
    case 'docs-site': {
      addDocsSite(workspaceRoot, resolvedName)
      break
    }
    case 'bicep-iac': {
      addBicepProject(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'svelte-app': {
      addSvelteApp(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'vue-app': {
      addVueApp(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'angular-app': {
      addAngularApp(workspaceRoot, resolvedName, stack, options.empty === true, options.e2e === true)
      break
    }
    case 'react-app': {
      addReactApp(workspaceRoot, resolvedName, stack, options.e2e === true, options.empty === true)
      break
    }
    case 'react-lib': {
      await addReactLib(workspaceRoot, resolvedName, options, kindProvided, stack)
      break
    }
    case 'react-internal-lib': {
      addReactInternalLib(workspaceRoot, resolvedName, stack, options.empty === true)
      break
    }
    case 'node-app': {
      addNodeApp(workspaceRoot, resolvedName, stack, options.framework, options.esm === true, options.empty === true)
      break
    }
    case 'node-function-app': {
      addNodeFunctionApp(workspaceRoot, resolvedName, stack, options.empty === true, options.esm === true)
      break
    }
    case 'npm-lib': {
      await addNpmLib(workspaceRoot, resolvedName, options, kindProvided, stack)
      break
    }
    case 'internal-lib': {
      // tsc (not none): the default @nx/enforce-module-boundaries rule forbids
      // buildable libraries (every npm-lib) from importing non-buildable ones,
      // so internal libs must be buildable — just never published (private).
      runNx(
        [
          'g',
          '@nx/js:lib',
          `libs/${resolvedName}`,
          '--bundler=tsc',
          `--unitTestRunner=${stack.testRunner}`,
          '--linter=none',
          '--no-interactive',
        ],
        workspaceRoot,
      )
      markPrivate(join(workspaceRoot, 'libs', resolvedName, 'package.json'))
      // Same @nx/js:lib placeholder, same slice reshape — see
      // renameScaffoldPlaceholder.
      renameScaffoldPlaceholder(join(workspaceRoot, 'libs', resolvedName), resolvedName, options.empty === true)
      removeGeneratedEslintConfig(workspaceRoot, `libs/${resolvedName}`)
      registerProjectCommands(workspaceRoot, resolvedName, { build: true })
      break
    }
    case 'python-app': {
      addPythonApp(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'python-function-app': {
      addPythonFunctionApp(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'python-lib': {
      addPythonLib(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'python-internal-lib': {
      addPythonInternalLib(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'container': {
      addContainer(workspaceRoot, resolvedName, { app: options.app as string, port: options.port === undefined ? undefined : Number(options.port) })
      break
    }
    case 'go-app': {
      addGoApp(workspaceRoot, resolvedName, { release: options.release, cgo: options.cgo, web: options.web, empty: options.empty === true })
      break
    }
    case 'go-function-app': {
      addGoFunctionApp(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'go-lib': {
      addGoLib(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'go-internal-lib': {
      addGoInternalLib(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'flutter-app': {
      addFlutterApp(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'flutter-lib': {
      addFlutterLib(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'flutter-internal-lib': {
      addFlutterInternalLib(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'csharp-app': {
      addCsharpApp(workspaceRoot, resolvedName, undefined, options.empty === true)
      break
    }
    case 'csharp-function-app': {
      addCsharpFunctionApp(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'csharp-lib': {
      await addCsharpLib(workspaceRoot, resolvedName, options, kindProvided)
      break
    }
    case 'csharp-internal-lib': {
      addCsharpInternalLib(workspaceRoot, resolvedName, options.empty === true)
      break
    }
    case 'vscode-extension': {
      addVscodeExtension(workspaceRoot, resolvedName, stack, {
        publisher: options.publisher,
        sidecar:   options.sidecar,
      })
      break
    }
    case 'python-vendor': {
      await addPythonVendor(workspaceRoot, resolvedName, options, kindProvided)
      // `resolvedName` is the consumer, not something newly created — the
      // generic "Added ... 'name'" success message below reads wrong for
      // this kind, so it returns early with its own message instead.
      syncProjectReferences(workspaceRoot)
      runFormatter(workspaceRoot)

      return
    }
    default: {
      // Unreachable while every ProjectKind has a case above: `exhaustive`
      // being `never` makes adding a new kind without a matching case a
      // *compile-time* error, not just a runtime gap. The CLI itself already
      // rejects an unrecognized value before this ever runs (cli.ts's
      // Argument#choices()); this is the last line of defense for any other
      // caller of runAdd (e.g. a future programmatic use).
      const exhaustive: never = resolvedKind
      throw new Error(
        `Unknown project kind '${exhaustive as string}'. Expected one of: ${PROJECT_KINDS.join(', ')}.`,
      )
    }
  }

  relocateRootRuntimeDependencies(workspaceRoot, resolvedName, rootDependenciesBefore)

  syncProjectReferences(workspaceRoot)

  // Nx's generators write in their own style (semicolons, double quotes), and
  // `nx sync` plus the root-manifest/`.code-workspace` edits above touch files
  // outside the new project — so this formats the workspace, not just
  // `<projectRoot>`. Keeps `npm run format:check` green after every add.
  // First, the lockfile: the generators' installs wrote it with the local npm, and CI's is newer (#295).
  completeLockfile(workspaceRoot)
  runFormatter(workspaceRoot)

  logger.success(`Added ${resolvedKind} '${resolvedName}'.`)
}

/**
 * The workspace stack, read back from the `nx.json` `mnci.stack` block `new` wrote.
 *
 * @remarks
 * How a one-time `mnci new` choice reaches `add`: `mnci.stack` (written by
 * `mnciConfig` in `overlay.ts`) is the single source of truth — a dedicated
 * block, not inferred from one of Nx's own (three, always-identical)
 * generator-default blocks, so there's no "stay in lockstep" invariant to
 * silently drift. `add` passes the result back to the `@nx/*`
 * generators explicitly (predictable regardless of Nx's own default
 * resolution). The return shape is generator-facing: `linter` is `eslint`, or `none` when the
 * workspace chose oxlint (oxlint is not an Nx linter). Missing/blank (e.g. a
 * workspace generated before this field existed) falls back to the default
 * opinion (eslint + jest).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The linter and test runner to apply.
 * @throws Propagates any `fs`/JSON error reading `nx.json`.
 * @typeParam None - this function has no generic type parameters.
 */
function readWorkspaceStack (workspaceRoot: string): WorkspaceStack {
  const nxJson = readJson<{ mnci?: { stack?: { testRunner?: string; linter?: string } } }>(
    join(workspaceRoot, 'nx.json'),
  )
  const stack = nxJson.mnci?.stack

  return {
    testRunner: stack?.testRunner === 'vitest' ? 'vitest' : 'jest',
  }
}
