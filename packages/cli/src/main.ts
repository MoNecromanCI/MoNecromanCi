import { Argument, Command, Option } from 'commander'
import { CI_PHASES, runCiPhase, type CiPhase } from './ci-pipeline'
import { PROJECT_KINDS, runAdd, runKinds, type AddOptions, type KindsOptions, type ProjectKind } from './project-scaffolding'
import { runDev, type DevOptions } from './dev-servers'
import { addPipelineTemplate, listPipelineTemplates, PIPELINE_TEMPLATES, type AddPipelineTemplateOptions } from './pipeline-templates'
import { serveMcp } from './mcp-server'
import { runDoctor, type DoctorOptions } from './workspace-diagnostics'
import { runAdopt, type AdoptOptions } from './repository-adoption'
import { runCommands, type CommandsOptions } from './command-catalog'
import { runInfo, runProjects, type InfoOptions, type ProjectsOptions } from './workspace-info'
import { runInteractive } from './interactive-wizard'
import { PRESET_IDS } from './workspace-presets'
import { runNew, type NewOptions } from './workspace-creation'
import { runInstall, type InstallOptions } from './dependency-management'
import { runSync, type SyncOptions } from './dependency-management'
import { runUp, type UpOptions } from './dependency-management'
import { runUpgrade, type UpgradeOptions } from './workspace-upgrade'
import { logger } from './terminal'
import { checkForUpdate, readCliVersion } from './cli-version'

/**
 * Builds the commander program for the CLI.
 *
 * @remarks
 * Eleven commands: `new`, `add`, `upgrade` (re-applies the overlay to an existing
 * workspace), `doctor` (read-only invariant check), `sync` (converge dependency
 * ranges and TypeScript project references), `up` (report and apply
 * available upgrades) and `ci` (runs a phase of the CI pipeline here, as CI runs
 * it). Everything else a generated repo needs day-to-day (build/test/lint/release)
 * is plain Nx, so the CLI deliberately has no wrapper commands for those. `ci` is
 * the one apparent exception and is not a shortcut for them: it is the pipeline's
 * own logic, moving out of inline scripts in the generated YAML into tested code,
 * so a laptop and a pipeline run the same thing (#269).
 *
 * `sync` and `up` exist because Nx covers neither: `nx sync` runs the
 * workspace's sync generators, and the only one registered is
 * `@nx/js:typescript-sync` — TypeScript project references, no opinion at all
 * about dependency versions. And npm has no `catalog:`, so one version per
 * workspace is a convention nothing enforces.
 *
 * @param cliVersion - The current CLI version (from package.json).
 * @returns The configured commander program.
 * @throws Never - wiring only; execution errors surface when commands run.
 * @typeParam None - this function has no generic type parameters.
 */
export function buildProgram (cliVersion: string): Command {
  const program = new Command()

  program
    .name('mnci')
    .description('MoNecromanCI — a thin CLI over official Nx plugins')
    .version(cliVersion, '-v, --version', 'display the version')

  program
    .command('new')
    .argument('[name]', 'workspace name')
    .description('Create a new monorepo (Nx TS preset + release/pipeline overlay)')
    .option('-y, --yes', 'accept defaults for anything not passed as a flag')
    .option('--scope <scope>', 'npm scope for publishable packages (e.g. @demo)')
    .addOption(new Option('--registry <kind>', 'package registry').choices(['azure-artifacts', 'npm']))
    .option('--organization <name>', 'Azure DevOps organization')
    .option('--project <name>', 'Azure DevOps project')
    .option('--artifacts-feed <name>', 'Azure Artifacts feed')
    .option(
      '--agent <pool>',
      'CI build agent: a vmImage (e.g. ubuntu-latest) or self-hosted pool name',
    )
    .option('--variable-group <name>', 'Azure DevOps variable group holding the npm PAT')
    .option(
      '--npm-auth <mode>',
      'how npm authenticates to an Azure Artifacts feed: pat (default) | build-identity (npmAuthenticate@0, no PAT; --ci azure only)',
    )
    .addOption(new Option('--ci <provider>', 'CI provider').choices(['azure', 'github', 'both']))
    .option('--test-runner <runner>', 'unit-test runner: jest | vitest')
    .option('--nx-cloud', 'connect the workspace to Nx Cloud (remote caching + CI insights)')
    .option(
      '--into <dir>',
      'bootstrap into an existing directory (a fresh clone holding only .git); the directory name is the workspace name unless one is given',
    )
    .addOption(
      new Option('--preset <preset>', 'also scaffold a whole shape of workspace, its projects wired together (web-api: a React frontend and an Express API sharing one library)')
        .choices(PRESET_IDS),
    )
    .action(async (name: string | undefined, options: NewOptions) => {
      await runNew(name, options)
    })

  program
    .command('upgrade')
    .description(
      'Re-apply the latest MoNecromanCI overlay to this workspace (release config, pipeline, npmrc, commitlint, husky hook, curated scripts)',
    )
    .option('--scope <scope>', 'npm scope for publishable packages (overrides the persisted value)')
    .option('--registry <kind>', 'azure-artifacts | npm (overrides the persisted value)')
    .option('--organization <name>', 'Azure DevOps organization')
    .option('--project <name>', 'Azure DevOps project')
    .option('--artifacts-feed <name>', 'Azure Artifacts feed')
    .option('--agent <pool>', 'CI build agent (overrides the persisted value)')
    .option('--variable-group <name>', 'Azure DevOps variable group holding the npm PAT')
    .option(
      '--npm-auth <mode>',
      'how npm authenticates to an Azure Artifacts feed: pat (default) | build-identity (npmAuthenticate@0, no PAT; --ci azure only)',
    )
    .option('--ci <provider>', 'CI provider: azure | github | both (overrides the persisted value)')
    .option(
      '--test-runner <runner>',
      'unit-test runner: jest | vitest (overrides the persisted value)',
    )
    .action((options: UpgradeOptions) => {
      runUpgrade(process.cwd(), options)
    })

  program
    .command('dev')
    .argument('[projects...]', 'the projects to start (those with a start command)')
    .description('Start several projects together, such as a frontend and the API it calls: runs their start targets as one Nx command, so Ctrl+C stops them all. Name the projects, pass --all, or pick from a list')
    .option('--all', 'start every project that has a start command')
    .option('--dry-run', 'print the Nx command and start nothing')
    .action(async (projects: string[], options: DevOptions) => {
      await runDev(process.cwd(), projects, options)
    })

  program
    .command('doctor')
    .description(
      'Check this workspace against the invariants mnci maintains (one ESLint config, no stray .prettierrc, the eslint plugin registered, the resolved eslint major, .npmrc vs the recorded registry, versionActions overrides, nx sync) — read-only; exits non-zero if anything failed',
    )
    .option('--json', 'print the findings as one JSON document, each with its remedy')
    .action((options: DoctorOptions) => {
      runDoctor(process.cwd(), options)
    })

  program
    .command('adopt')
    .description('Read an existing repository and report what bringing it under mnci would involve: blockers, warnings and the step that clears each. Read-only unless a step flag is given; exits non-zero when something blocks')
    .option('--json', 'print the report as one JSON document')
    .option('--tags', 'create, locally, the baseline tag each project whose release tags are stranded under an old name needs; nothing is pushed')
    .option('--toolchain', 'retire old formatter and registry tooling, align the Nx family to one version and run npm audit fix until the audit gate passes; needs a clean git tree and leaves the changes uncommitted')
    .option('--nx <version>', 'the Nx version --toolchain aligns to (default: the newest published in the major already in use)')
    .option('--dependencies', 'move the root package.json runtime dependencies into the projects that import them (same range), then reinstall; a package no project imports stays and is listed; needs a clean git tree')
    .option('--kinds', 'record each project\'s mnci kind as a type:<kind> tag (npm, Python, Go, Flutter and C# projects); a project where two kinds fit is listed with a guess and not tagged; needs a clean git tree')
    .option('--kind <dir=kind>', 'the kind you choose for one project, for --kinds (repeatable)', (value: string, previous: string[] = []) => [...previous, value])
    .option('--overlay', 'apply the mnci overlay (release config, pipeline, npmrc, commitlint, scripts) with the flags mnci upgrade takes; the pipeline keeps the steps mnci does not recognise in its slots; needs a clean git tree and an nx.json')
    .option('--scope <scope>', 'npm scope for publishable packages (--overlay)')
    .option('--registry <kind>', 'azure-artifacts | npm (--overlay)')
    .option('--organization <name>', 'Azure DevOps organization (--overlay)')
    .option('--project <name>', 'Azure DevOps project (--overlay)')
    .option('--artifacts-feed <name>', 'Azure Artifacts feed (--overlay)')
    .option('--agent <pool>', 'CI build agent (--overlay)')
    .option('--variable-group <name>', 'Azure DevOps variable group holding the npm PAT (--overlay)')
    .option('--npm-auth <mode>', 'pat (default) | build-identity (--overlay, --ci azure only)')
    .option('--ci <provider>', 'azure | github | both (--overlay; default: what the repository already has)')
    .option('--test-runner <runner>', 'jest | vitest (--overlay; default: what the repository already declares)')
    .action((options: AdoptOptions) => {
      runAdopt(process.cwd(), options)
    })

  program
    .command('ci')
    .addArgument(new Argument('<phase>', 'which phase of the pipeline to run').choices(CI_PHASES))
    .description(
      'Run a phase of the CI pipeline here, the same way CI runs it: `verify` is the sync check and then every project (or, in a pull request, the affected ones) through lint, typecheck, test and build. `setup` installs the Python, Go and Flutter toolchains the workspace needs, `audit` fails on a known advisory that has a fix, `pack` builds the per-app artifacts, `release` versions, tags and publishes, and `native` builds the apps that need a C toolchain on this OS. Exits non-zero when it fails',
    )
    .action(async (phase: CiPhase) => {
      process.exitCode = await runCiPhase(phase, process.cwd())
    })

  program
    .command('pipeline')
    .addArgument(new Argument('[template]', 'the pipeline to add; leave out to list them').choices(PIPELINE_TEMPLATES.map(each => each.name)))
    .description(
      'Add a ready-made pipeline file to this workspace after it was generated: e2e, package-zip (the dist/drop zips as a build artifact), deploy-pages (a react-app to GitHub Pages) or deploy-azure-function. Written once and yours from then on, so `mnci upgrade` never rewrites it; an existing file is kept unless --force. With no template, lists them',
    )
    .option('--project <app>', 'the app a deploy template builds or deploys (a name under apps/)')
    .addOption(new Option('--ci <provider>', 'the provider to write for (default: the one this workspace uses)').choices(['azure', 'github', 'both']))
    .option('--force', 'overwrite a pipeline file that already exists')
    .action((template: string | undefined, options: AddPipelineTemplateOptions) => {
      if (template === undefined) {
        listPipelineTemplates()

        return
      }
      addPipelineTemplate(process.cwd(), template, options)
    })

  program
    .command('mcp')
    .description(
      'Serve this workspace to an AI assistant over the Model Context Protocol (stdio): tools to list the projects, kinds and commands, run the doctor, add a project, install a dependency, sync versions and add a pipeline. Register it in the assistant as the command `npx mnci mcp`, started in the workspace root',
    )
    .action(async () => {
      await serveMcp(process.cwd(), process.argv[1], cliVersion)
    })

  program
    .command('sync')
    .description(
      "Make every project agree: converge external dependency ranges declared at more than one version, then run 'nx sync' for TypeScript project references. Go is a no-op — one root go.mod means one version of every module",
    )
    .option('--check', 'report drift and exit non-zero without writing anything')
    .option('--ecosystem <name>', 'restrict to one ecosystem: npm | pip | pub | go')
    .action((options: SyncOptions) => {
      runSync(process.cwd(), options)
    })

  program
    .command('up')
    .description(
      'Show every dependency with a newer published release — grouped patch/minor/major/non-semver, with the projects declaring each one — and interactively update the ones you pick',
    )
    .option('--check', 'report only; never prompt and never write (the default when piped)')
    .option('-y, --yes', 'select every available update without prompting')
    .option('--ecosystem <name>', 'restrict to one ecosystem: npm | pip | pub | go')
    .option('--no-install', 'update the manifests but skip the reinstall step')
    .action(async (options: UpOptions) => {
      await runUp(process.cwd(), options)
    })

  program
    .command('install')
    .alias('i')
    .argument('[packages...]', 'packages to add (a bare name or a pinned spec); omit to install only')
    .description(
      "Add a dependency to a specific project using its own toolchain (npm/pip/pub/nuget/go), or — with no package — install everything. Each project owns its dependencies, so a package needs a target: 'mnci i -w <project> <package>'",
    )
    .option(
      '-w, --workspace <project>',
      'target project, by directory (apps/foo) or basename (foo); give the flag again for each project',
      (project: string, projects: string[]) => [...projects, project],
      [] as string[],
    )
    .option('-D, --save-dev', 'add as a development dependency, where the ecosystem distinguishes one')
    .action((packages: string[], options: InstallOptions) => {
      runInstall(process.cwd(), packages, options)
    })

  program
    .command('add')
    // choices() rejects an unrecognized kind with a clean commander usage
    // error (and lists the valid ones in --help) before runAdd ever runs —
    // instead of a typo silently doing nothing but reporting "success".
    .addArgument(new Argument('[kind]', 'project kind').choices(PROJECT_KINDS))
    .argument('[name]', 'project name')
    .description('Add a project by delegating to the matching Nx plugin generator')
    .option('--scope <scope>', 'npm scope for a publishable lib (defaults to @<workspace name>)')
    .addOption(
      new Option('--framework <framework>', 'node-app only: the web framework (default: none)')
        .choices(['express', 'fastify', 'koa', 'nest', 'none']),
    )
    .option(
      '--empty',
      'npm-lib, internal-lib, react-lib, react-internal-lib, node-function-app: scaffold the slice skeleton only, with no sample code or spec',
    )
    .option('--app <project>', 'container only: the app to put in an image (a node-app, react-app or go-app)')
    .option('--port <port>', 'container only: the port the app listens on, exposed by the image and published by start')
    .option(
      '--e2e',
      'react-app only: also scaffold a Playwright end-to-end project, <name>-e2e, that runs the app and checks its greeting; its e2e target needs a browser (npx playwright install) and is not part of CI verify',
    )
    .option(
      '--esm',
      'node-app, node-function-app: ES module output ("type": "module", explicit .js import specifiers, Jest mapped to match); not with fastify or nest',
    )
    .option(
      '--lib <name>',
      'python-vendor only: the internal Python library (libs/<name>) to vendor into <name>',
    )
    .option(
      '--publisher <id>',
      'vscode-extension only: the Marketplace publisher id (defaults to the workspace scope without @)',
    )
    .option(
      '--sidecar <go-app>',
      'vscode-extension only: a go-app whose six-platform build ships in the extension, one .vsix per platform',
    )
    .option(
      '--release',
      'go-app only: release the app. Versioned from its git tag, its six-platform zips attached to its GitHub Release',
    )
    .option(
      '--cgo',
      'go-app only: the app needs a C toolchain (a tray icon, a native GUI, a cgo driver), so CI builds it on a runner of each OS instead of cross-compiling',
    )
    .option(
      '--web <react-app>',
      'go-app only: embed and serve this React app (apps/<react-app>, added first): built before the Go app, staged for go:embed, with a dev target that runs both',
    )
    .action(
      async (kind: ProjectKind | undefined, name: string | undefined, options: AddOptions) => {
        await runAdd(kind, name, options)
      },
    )

  program
    .command('commands')
    .description('List every command with what it does and how to call it (--json is what an editor builds its menu from)')
    .option('--json', 'print the catalog as one JSON document')
    .action((options: CommandsOptions) => {
      runCommands(program, options)
    })

  program
    .command('kinds')
    .description('List every project kind that `add` accepts, with its language, a description and the flags that apply')
    .option('--json', 'print the kinds as one JSON document')
    .action((options: KindsOptions) => {
      runKinds(options)
    })

  program
    .command('projects')
    .description("List this workspace's projects: directory, ecosystem, the kind mnci recorded and its explicit targets")
    .option('--json', 'print the projects as one JSON document')
    .action((options: ProjectsOptions) => {
      runProjects(process.cwd(), options)
    })

  program
    .command('info')
    .description("Show the installed mnci version, the newest published one, and this workspace's recorded settings")
    .option('--json', 'print the report as one JSON document')
    .action((options: InfoOptions) => {
      runInfo(process.cwd(), cliVersion, options)
    })

  // Bare `mnci` (no subcommand) launches the guided wizard; commander runs
  // this default action only when no subcommand is given (-v/--help still win).
  program.action(async () => {
    await runInteractive(program)
  })

  return program
}

/**
 * CLI entry point: parse arguments and surface failures as exit code 1.
 *
 * @remarks
 * Exported so tests can drive the program without spawning a process.
 * Runs a non-blocking version check in the background (fire-and-forget), and
 * prints a `mnci vX.Y.Z` banner for interactive use — gated on stdout being a
 * TTY (like {@link checkForUpdate}) so CI/piped invocations see nothing extra,
 * and skipped when `-v`/`--version` was passed explicitly since commander
 * already prints the bare version for that case; a banner above it would just
 * be a redundant duplicate.
 *
 * @param None - this function takes no parameters.
 * @returns A promise that resolves when the invoked command completes.
 * @throws Never - failures are logged and turned into a non-zero exit code.
 * @typeParam None - this function has no generic type parameters.
 */
export async function main (): Promise<void> {
  try {
    const cliVersion = readCliVersion(__dirname)
    const program = buildProgram(cliVersion)

    // Check for updates in the background (non-blocking).
    checkForUpdate(cliVersion)

    const arguments_ = new Set(process.argv.slice(2))
    const requestedVersionFlag = arguments_.has('-v') || arguments_.has('--version')
    if (!requestedVersionFlag && process.stdout.isTTY) {
      logger.info(`mnci v${cliVersion}`)
    }

    await program.parseAsync(process.argv)
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

// Only self-execute when run as a binary, not when imported by tests.
//
// `void` rather than `await`/`.catch()`: `main` cannot reject — it wraps its whole
// body in a try/catch that logs and sets a non-zero exit code — so there is no
// rejection to handle, and there is nothing after this to sequence. The operator
// states that deliberately instead of leaving a bare floating promise that reads
// like an oversight.
if (require.main === module) {
  void main()
}
