import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCapture, runShell } from '../nx-workspace'
import { fileExists, readCodeWorkspace, readJson, toJson, writeFileEnsured } from '../file-system'
import { logger, promptConfirm } from '../terminal'
import { completeLockfile } from '../lockfile-completion'
import { locateProjects } from '../dependency-management'
import {
  removeCargoWorkspaceMember,
  removeGoWorkUse,
  removeMavenModule,
  removePathAliases,
  removeProjectScripts,
  removePubspecWorkspaceMember,
} from './workspace-entries.algorithm'

/**
 * Options for `mnci remove`.
 *
 * @remarks
 * Each is a flag of the command: `--dry-run`, `--yes` and `--force`.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RemoveOptions {
  /** Print what would change and stop. */
  dryRun?: boolean
  /** Apply without asking: required when stdin is not a terminal. */
  yes?:    boolean
  /** Remove even when another project depends on it. */
  force?:  boolean
}

/** The folders a project lives directly under. */
const PROJECT_ROOTS = ['apps', 'libs', 'packages', 'python-packages'] as const

/**
 * What removing one project changes, worked out before anything is touched.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
interface RemovalPlan {
  /** Workspace-relative folders that are deleted. */
  folders:         string[]
  /** Root `package.json` scripts that are dropped. */
  scripts:         string[]
  /** Launch configurations and tasks in the `.code-workspace` file that are dropped. */
  launch:          string[]
  /** `tsconfig.base.json` path aliases that are dropped. */
  aliases:         string[]
  /** Other workspace files that name the project, by what is edited. */
  entries:         string[]
  /** Projects that depend on this one. */
  dependents:      string[]
  /** Whether the dependents could be determined. */
  dependentsKnown: boolean
}

/**
 * Finds the folder of a project: by directory, or by its name under one of the project roots.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param target - What the user typed, a directory (`apps/web`) or a name (`web`).
 * @returns The workspace-relative directory, or `undefined` when none or several match.
 * @throws Never - an unreadable folder reads as absent.
 * @typeParam None - this function has no generic type parameters.
 */
function resolveProject (workspaceRoot: string, target: string): string | undefined {
  const located = locateProjects(workspaceRoot)
  const byDir = located.find(project => project.dir === target)
  if (byDir !== undefined) {
    return byDir.dir
  }
  const byName = located.filter(project => project.name === target)
  if (byName.length === 1) {
    return byName[0].dir
  }
  if (byName.length > 1) {
    logger.error(`'${target}' matches ${byName.length} projects (${byName.map(project => project.dir).join(', ')}) — name it by directory`)

    return undefined
  }
  // A project with no manifest this tool reads (a Bicep project, a docs site): its folder is enough.
  const folders = PROJECT_ROOTS.map(root => `${root}/${target}`).filter(candidate => existsSync(join(workspaceRoot, candidate)) && statSync(join(workspaceRoot, candidate)).isDirectory())

  return folders.length === 1 ? folders[0] : undefined
}

/**
 * Asks Nx which projects depend on the one at `directory`.
 *
 * @remarks
 * From `nx graph --file`, the graph Nx itself builds from imports and manifests, so it knows what a text search of mnci's
 * would not (TypeScript imports, project references, `ProjectReference`s, `path` dependencies). A failure is reported as
 * unknown rather than as "none".
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param directory - The project's workspace-relative directory.
 * @returns The names of the dependents and whether they could be determined.
 * @throws Never - a graph that cannot be built reads as unknown.
 * @typeParam None - this function has no generic type parameters.
 */
function findDependents (workspaceRoot: string, directory: string): { names: string[], known: boolean } {
  const file = join(tmpdir(), `mnci-remove-graph-${process.pid}.json`)
  try {
    const result = runCapture('npx', ['nx', 'graph', `--file=${file}`], workspaceRoot)
    if (result.status !== 0 || !existsSync(file)) {
      return { names: [], known: false }
    }
    const { graph } = JSON.parse(readFileSync(file, 'utf8')) as {
      graph: { nodes: Record<string, { data?: { root?: string } }>, dependencies: Record<string, Array<{ target: string }>> }
    }
    const node = Object.entries(graph.nodes).find(([, value]) => value.data?.root === directory)?.[0]
    if (node === undefined) {
      return { names: [], known: false }
    }
    const names = Object.entries(graph.dependencies)
      .filter(([source, targets]) => source !== node && targets.some(target => target.target === node))
      .map(([source]) => source)

    return { names, known: true }
  } catch {
    return { names: [], known: false }
  } finally {
    rmSync(file, { force: true })
  }
}

/**
 * Finds the `.code-workspace` file of the workspace.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Its absolute path, or `undefined` when there is none.
 * @throws Never - an unreadable folder reads as none.
 * @typeParam None - this function has no generic type parameters.
 */
function codeWorkspaceFile (workspaceRoot: string): string | undefined {
  try {
    const entry = readdirSync(workspaceRoot).find(file => file.endsWith('.code-workspace'))

    return entry === undefined ? undefined : join(workspaceRoot, entry)
  } catch {
    return undefined
  }
}

/**
 * Works out what removing a project changes.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param directory - The project's workspace-relative directory.
 * @returns The plan.
 * @throws Never - an unreadable file reads as not naming the project.
 * @typeParam None - this function has no generic type parameters.
 */
function planRemoval (workspaceRoot: string, directory: string): RemovalPlan {
  const name = basename(directory)
  const folders = [directory]
  // A React app made with --e2e has a paired Playwright project, which has no purpose without it.
  const paired = `${directory.slice(0, directory.lastIndexOf('/'))}/${name}-e2e`
  if (existsSync(join(workspaceRoot, paired))) {
    folders.push(paired)
  }
  // A C# project's tests live apart, in tests/<identity>/, and name the project in their own project.json.
  const testsRoot = join(workspaceRoot, 'tests')
  if (existsSync(testsRoot)) {
    for (const entry of readdirSync(testsRoot)) {
      const projectJson = join(testsRoot, entry, 'project.json')
      if (fileExists(projectJson) && (readJson<{ name?: string }>(projectJson).name ?? '') === `${name}-tests`) {
        folders.push(`tests/${entry}`)
      }
    }
  }

  const manifest = fileExists(join(workspaceRoot, 'package.json')) ? readJson<{ scripts?: Record<string, string> }>(join(workspaceRoot, 'package.json')) : {}
  const scripts = removeProjectScripts(manifest.scripts ?? {}, name).removed

  const launch: string[] = []
  const codeWorkspace = codeWorkspaceFile(workspaceRoot)
  const file = codeWorkspace === undefined ? undefined : readCodeWorkspace<{ launch?: { configurations?: Array<{ name?: string }> }, tasks?: { tasks?: Array<{ label?: string }> } }>(codeWorkspace)
  const configurations = file?.launch?.configurations ?? []
  for (const configuration of configurations) {
    if (typeof configuration.name === 'string' && configuration.name.startsWith(`mnci: ${name} `)) {
      launch.push(configuration.name)
    }
  }
  const tasks = file?.tasks?.tasks ?? []
  for (const task of tasks) {
    if (typeof task.label === 'string' && task.label.startsWith(`${name}: `)) {
      launch.push(task.label)
    }
  }

  const aliases = fileExists(join(workspaceRoot, 'tsconfig.base.json'))
    ? removePathAliases(readJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(join(workspaceRoot, 'tsconfig.base.json')).compilerOptions?.paths ?? {}, directory).removed
    : []

  const entries: string[] = []
  const edits: Array<[string, (text: string) => string]> = [
    ['go.work', text => removeGoWorkUse(text, directory)],
    ['pubspec.yaml', text => removePubspecWorkspaceMember(text, directory)],
    ['Cargo.toml', text => removeCargoWorkspaceMember(text, directory)],
    ['pom.xml', text => removeMavenModule(text, directory)],
  ]
  for (const [path, edit] of edits) {
    const full = join(workspaceRoot, path)
    if (fileExists(full)) {
      const text = readFileSync(full, 'utf8')
      if (edit(text) !== text) {
        entries.push(path)
      }
    }
  }

  const dependents = findDependents(workspaceRoot, directory)

  return { folders, scripts, launch, aliases, entries, dependents: dependents.names, dependentsKnown: dependents.known }
}

/**
 * Prints a plan.
 *
 * @param directory - The project's workspace-relative directory.
 * @param plan - What would change.
 * @returns Nothing.
 * @throws Never - logging only.
 * @typeParam None - this function has no generic type parameters.
 */
function printPlan (directory: string, plan: RemovalPlan): void {
  logger.step(`Removing ${directory}`)
  for (const folder of plan.folders) {
    logger.info(`  delete ${folder}/`)
  }
  if (plan.scripts.length > 0) {
    logger.info(`  drop ${plan.scripts.length} root script(s): ${plan.scripts.join(', ')}`)
  }
  if (plan.launch.length > 0) {
    logger.info(`  drop ${plan.launch.length} launch configuration(s) from the .code-workspace file`)
  }
  for (const alias of plan.aliases) {
    logger.info(`  drop the ${alias} alias from tsconfig.base.json`)
  }
  for (const entry of plan.entries) {
    logger.info(`  take it out of ${entry}`)
  }
  logger.info('  then: nx sync, the lockfile, and a doctor check; git tags and registry versions are not touched')
}

/**
 * Applies a plan.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param directory - The project's workspace-relative directory.
 * @param plan - What to change.
 * @returns Nothing.
 * @throws Propagates any `fs` error.
 * @typeParam None - this function has no generic type parameters.
 */
function applyRemoval (workspaceRoot: string, directory: string, plan: RemovalPlan): void {
  const name = basename(directory)
  for (const folder of plan.folders) {
    rmSync(join(workspaceRoot, folder), { recursive: true, force: true })
  }

  const manifestPath = join(workspaceRoot, 'package.json')
  if (plan.scripts.length > 0 && fileExists(manifestPath)) {
    const manifest = readJson<Record<string, unknown> & { scripts?: Record<string, string> }>(manifestPath)
    writeFileEnsured(manifestPath, toJson({ ...manifest, scripts: removeProjectScripts(manifest.scripts ?? {}, name).scripts }))
  }

  const codeWorkspace = codeWorkspaceFile(workspaceRoot)
  if (codeWorkspace !== undefined && plan.launch.length > 0) {
    const file = readCodeWorkspace<{ launch?: { configurations?: Array<Record<string, unknown>> }, tasks?: { tasks?: Array<Record<string, unknown>> } } & Record<string, unknown>>(codeWorkspace) ?? {}
    const keep = (value: unknown, prefix: string): boolean => typeof value !== 'string' || !value.startsWith(prefix)
    writeFileEnsured(codeWorkspace, toJson({
      ...file,
      launch: file.launch === undefined ? undefined : { ...file.launch, configurations: (file.launch.configurations ?? []).filter(item => keep(item.name, `mnci: ${name} `)) },
      tasks:  file.tasks === undefined ? undefined : { ...file.tasks, tasks: (file.tasks.tasks ?? []).filter(item => keep(item.label, `${name}: `)) },
    }))
  }

  const base = join(workspaceRoot, 'tsconfig.base.json')
  if (plan.aliases.length > 0 && fileExists(base)) {
    const config = readJson<{ compilerOptions?: { paths?: Record<string, string[]> } } & Record<string, unknown>>(base)
    const paths = removePathAliases(config.compilerOptions?.paths ?? {}, directory).paths
    writeFileEnsured(base, toJson({ ...config, compilerOptions: { ...config.compilerOptions, paths } }))
  }

  const edits: Array<[string, (text: string) => string]> = [
    ['go.work', text => removeGoWorkUse(text, directory)],
    ['pubspec.yaml', text => removePubspecWorkspaceMember(text, directory)],
    ['Cargo.toml', text => removeCargoWorkspaceMember(text, directory)],
    ['pom.xml', text => removeMavenModule(text, directory)],
  ]
  for (const [path, edit] of edits) {
    const full = join(workspaceRoot, path)
    if (plan.entries.includes(path) && fileExists(full)) {
      writeFileSync(full, edit(readFileSync(full, 'utf8')))
    }
  }
}

/**
 * Removes a project and every place that names it.
 *
 * @remarks
 * `mnci add` writes a project into more than its folder: root scripts, launch configurations, the Go, Dart and Cargo
 * workspaces, TypeScript path aliases, a paired end-to-end project, a C# test project. Deleting the folder by hand leaves
 * each of those, and a stale `go.work` entry breaks the whole Nx graph. This undoes all of them.
 *
 * It refuses while another project depends on this one (the dependents come from Nx's own graph) unless `--force`, prints
 * what it will do, and asks first (or needs `--yes` when there is no terminal). It ends with `nx sync`, the lockfile and
 * the Go workspace sync where relevant. It does not touch git tags or anything already published: that is the team's call.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param target - The project, by directory (`apps/web`) or name (`web`).
 * @param options - Dry run, assume yes, force.
 * @returns A promise that resolves when the project is removed or the run is refused or cancelled.
 * @throws Never - a refusal sets `process.exitCode` to 1.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runRemove (workspaceRoot: string, target: string, options: RemoveOptions = {}): Promise<void> {
  const directory = resolveProject(workspaceRoot, target)
  if (directory === undefined) {
    logger.error(`No project '${target}' — looked under apps/, libs/, packages/ and python-packages/. Name it by directory (apps/${target}) when two share a name`)
    process.exitCode = 1

    return
  }
  const plan = planRemoval(workspaceRoot, directory)
  if (plan.dependents.length > 0 && options.force !== true) {
    logger.error(`${directory} is used by ${plan.dependents.join(', ')} — remove or change those first, or pass --force`)
    process.exitCode = 1

    return
  }
  if (!plan.dependentsKnown) {
    logger.warn('Could not ask Nx which projects depend on it, so that was not checked')
  }
  printPlan(directory, plan)
  if (options.dryRun === true) {
    logger.info('Dry run: nothing was changed.')

    return
  }
  if (options.yes !== true) {
    if (!process.stdin.isTTY) {
      logger.error('There is no terminal to ask in — run again with --yes to apply, or --dry-run to only see the plan')
      process.exitCode = 1

      return
    }
    if (!(await promptConfirm(`Remove ${directory}?`, false))) {
      logger.info('Cancelled.')

      return
    }
  }

  applyRemoval(workspaceRoot, directory, plan)
  if (plan.entries.includes('go.work')) {
    runShell('go', ['work', 'sync'], workspaceRoot)
  }
  if (existsSync(join(workspaceRoot, 'nx.json'))) {
    runShell('npx', ['nx', 'sync'], workspaceRoot)
  }
  completeLockfile(workspaceRoot)
  logger.success(`Removed ${directory}. Run 'mnci doctor' to check the workspace; git tags and published versions were not touched.`)
}
