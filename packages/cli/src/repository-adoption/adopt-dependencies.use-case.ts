import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { locateProjects } from '../dependency-management'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { runCapture, runShell } from '../nx-workspace'
import { requireCleanWorkingTree } from './clean-working-tree.validator'
import { extractImportedPackages } from './extract-imports.algorithm'
import { planDependencyMoves, type DependencyPlan, type DependencyUsage } from './plan-dependency-moves.algorithm'

/** Source files whose imports count. */
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** Files that are tests: a package only they import is a development need. */
const TEST_FILE = /\.(?:spec|test)\.[^.]+$|[\\/](?:__tests__|tests?|e2e)[\\/]/

/** Directories never read: dependencies and build output. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', '.git', '.nx', 'tmp'])

/**
 * What {@link adoptDependencies} needs from its environment, so a test can run it without npm or git.
 *
 * @remarks
 * Every member has a real default.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DependenciesDependencies {
  /** Runs a command with its output shown; returns the exit status. */
  run:     (command: string, arguments_: string[], cwd: string) => number
  /** Runs a command and returns what it printed. */
  capture: (command: string, arguments_: string[], cwd: string) => { status: number, stdout: string }
}

/**
 * What the dependencies step did.
 *
 * @remarks
 * `plan` is what was decided; `installed` is whether the install that refreshes the lockfile succeeded.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DependenciesResult {
  /** The decision. */
  plan:      DependencyPlan
  /** Whether the install that follows the moves succeeded. */
  installed: boolean
}

/**
 * Lists the source files under a directory, as paths relative to it.
 *
 * @param directory - Absolute path to read.
 * @param relative - The path so far, for recursion.
 * @returns Every `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` and `.cjs` file outside dependency and build directories.
 * @throws Never - an unreadable directory has no files.
 * @typeParam None - this function has no generic type parameters.
 */
function sourceFiles (directory: string, relative = ''): string[] {
  const entries = readdirSync(join(directory, relative), { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...sourceFiles(directory, path))
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(path)
    }
  }

  return found
}

/**
 * The wanted packages one file imports, or none when it cannot be read.
 *
 * @param path - Absolute path to the file.
 * @param wanted - The package names to look for.
 * @returns The wanted names the file imports.
 * @throws Never - an unreadable file imports nothing.
 * @typeParam None - this function has no generic type parameters.
 */
function wantedImportsOf (path: string, wanted: ReadonlySet<string>): string[] {
  try {
    const imported = [...extractImportedPackages(readFileSync(path, 'utf8'))]

    return imported.filter(name => wanted.has(name))
  } catch {
    return []
  }
}

/**
 * The wanted packages one project imports, split by whether a shipped file or only a test file does.
 *
 * @param projectDirectory - Absolute path to the project.
 * @param wanted - The package names to look for.
 * @returns The packages imported from shipped source, and those imported only from tests.
 * @throws Never - an unreadable file is skipped.
 * @typeParam None - this function has no generic type parameters.
 */
function importsOfProject (projectDirectory: string, wanted: ReadonlySet<string>): { shipped: string[], testsOnly: string[] } {
  const shipped = new Set<string>()
  const tested = new Set<string>()
  const files = sourceFiles(projectDirectory)
  for (const file of files) {
    const names = wantedImportsOf(join(projectDirectory, file), wanted)
    const target = TEST_FILE.test(file) ? tested : shipped
    for (const name of names) {
      target.add(name)
    }
  }

  const shippedNames = [...shipped]

  return { shipped: shippedNames, testsOnly: [...tested].filter(name => !shippedNames.includes(name)) }
}

/**
 * Finds, for each wanted package, which projects import it and from what kind of file.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param projectDirectories - The npm projects, workspace-relative.
 * @param wanted - The package names to look for.
 * @returns The usage by package name.
 * @throws Never - an unreadable file is skipped.
 * @typeParam None - this function has no generic type parameters.
 */
function findUsage (repositoryRoot: string, projectDirectories: readonly string[], wanted: ReadonlySet<string>): Record<string, DependencyUsage> {
  const usage: Record<string, DependencyUsage> = {}
  for (const dir of projectDirectories) {
    const { shipped, testsOnly } = importsOfProject(join(repositoryRoot, dir), wanted)
    for (const name of shipped) {
      usage[name] ??= { runtime: [], testsOnly: [] }
      usage[name].runtime.push(dir)
    }
    for (const name of testsOnly) {
      usage[name] ??= { runtime: [], testsOnly: [] }
      usage[name].testsOnly.push(dir)
    }
  }

  return usage
}

/**
 * Moves the root manifest's runtime dependencies into the projects that import them.
 *
 * @remarks
 * mnci keeps shared tooling at the root and runtime dependencies in the package that imports them: the
 * root is private and never published, and a bundler externalises only what a project's own manifest
 * declares (`mnci doctor` reports the root dependencies that break this). A repository built before that
 * rule has them at the root. For each root `dependencies` entry this finds the npm projects that import it,
 * adds it to their manifest at the same range, and removes it from the root; a package nothing imports is
 * left and listed. Then it installs, so the lockfile follows. Needs a clean git tree and leaves the changes
 * uncommitted. `devDependencies` of the root stay: sharing the toolchain is what the root is for.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param dependencies - The process runner; real ones by default.
 * @returns What was decided and whether the install succeeded.
 * @throws Error when the tree is not clean, or there is no root `package.json`.
 * @typeParam None - this function has no generic type parameters.
 */
export function adoptDependencies (repositoryRoot: string, dependencies: Partial<DependenciesDependencies> = {}): DependenciesResult {
  const run = dependencies.run ?? runShell
  requireCleanWorkingTree(repositoryRoot, dependencies.capture ?? runCapture)
  const rootPath = join(repositoryRoot, 'package.json')
  if (!fileExists(rootPath)) {
    throw new Error('No package.json at the repository root.')
  }
  const root = readJson<{ dependencies?: Record<string, string> } & Record<string, unknown>>(rootPath)
  const rootDependencies = root.dependencies ?? {}

  const projects = locateProjects(repositoryRoot).filter(location => location.ecosystem === 'npm')
  const manifests = new Map(projects.map(location => [location.dir, readJson<{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> } & Record<string, unknown>>(location.manifestPath)]))
  const usage = findUsage(repositoryRoot, projects.map(location => location.dir), new Set(Object.keys(rootDependencies)))
  const declared = Object.fromEntries([...manifests].map(([dir, manifest]) => [dir, { ...manifest.devDependencies, ...manifest.dependencies }]))
  const plan = planDependencyMoves(rootDependencies, usage, declared)
  if (plan.moves.length === 0 && plan.removed.length === 0) {
    return { plan, installed: true }
  }

  for (const move of plan.moves) {
    const manifest = manifests.get(move.dir) as NonNullable<ReturnType<typeof manifests.get>>
    manifest[move.field] = Object.fromEntries(Object.entries({ ...manifest[move.field], [move.name]: move.range }).toSorted(([a], [b]) => a.localeCompare(b)))
  }
  for (const location of projects) {
    if (plan.moves.some(move => move.dir === location.dir)) {
      writeFileEnsured(location.manifestPath, toJson(manifests.get(location.dir)))
    }
  }
  const remaining = Object.fromEntries(Object.entries(rootDependencies).filter(([name]) => !plan.removed.includes(name)))
  if (Object.keys(remaining).length === 0) {
    Reflect.deleteProperty(root, 'dependencies')
  } else {
    root.dependencies = remaining
  }
  writeFileEnsured(rootPath, toJson(root))

  const installed = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], repositoryRoot) === 0

  return { plan, installed }
}
