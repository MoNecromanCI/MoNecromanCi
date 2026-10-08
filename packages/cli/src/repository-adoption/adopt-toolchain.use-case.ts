import { join } from 'node:path'
import { runAudit } from '../ci-pipeline'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { pruneStaleLocalRegistry } from '../lockfile-pruning'
import { runCapture, runShell } from '../nx-workspace'
import { alignNxFamily, chooseNxVersion } from './align-nx-family.algorithm'
import { requireCleanWorkingTree } from '../clean-working-tree'
import { retireTooling } from './retire-tooling.use-case'

/** How many times `npm audit fix` is run before giving up: it needed three passes on a real workspace. */
const MAX_AUDIT_FIX_PASSES = 4

/**
 * What {@link adoptToolchain} needs from its environment, so a test can run it without npm or a network.
 *
 * @remarks
 * Every member has a real default.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ToolchainDependencies {
  /** Runs a command with its output shown; returns the exit status. */
  run:     (command: string, arguments_: string[], cwd: string) => number
  /** Runs a command and returns what it printed. */
  capture: (command: string, arguments_: string[], cwd: string) => { status: number, stdout: string }
  /** Runs the audit gate; 0 when it passes. */
  audit:   (repositoryRoot: string) => number
  /** Reports one line of progress. */
  log:     (message: string) => void
}

/**
 * Options of the toolchain step.
 *
 * @remarks
 * Only the Nx version can be chosen.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ToolchainOptions {
  /** The Nx version to align to; by default the newest published in the major already in use. */
  nxVersion?: string
}

/**
 * What the toolchain step did.
 *
 * @remarks
 * `auditPasses` is true when the audit gate passes at the end, which is the step's definition of done.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ToolchainResult {
  /** Retired tooling that was removed. */
  removed:     string[]
  /** The Nx family members that moved, and the version they moved to. */
  aligned:     { names: string[], version?: string }
  /** How many `npm audit fix` passes ran. */
  auditFixes:  number
  /** Whether the audit gate passes now. */
  auditPasses: boolean
}

/**
 * Reads the versions of `nx` the registry lists, asking npm itself so private feeds and their auth just work.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param capture - Runs a command and returns its output.
 * @returns Every published version, or none when npm could not answer.
 * @throws Never - an unreadable answer is an empty list.
 * @typeParam None - this function has no generic type parameters.
 */
function publishedNxVersions (repositoryRoot: string, capture: ToolchainDependencies['capture']): string[] {
  const answer = capture('npm', ['view', 'nx', 'versions', '--json'], repositoryRoot)
  try {
    const parsed = JSON.parse(answer.stdout) as unknown

    return Array.isArray(parsed) ? parsed.filter((version): version is string => typeof version === 'string') : []
  } catch {
    return []
  }
}

/**
 * Brings a repository's toolchain to what mnci supports: retired tooling gone, one Nx version, an audit that passes.
 *
 * @remarks
 * Refuses a directory that is not a git work tree or has uncommitted changes, so the result is one diff
 * to review. It changes files and leaves them uncommitted, as `mnci upgrade` does. The audit fix runs
 * `npm audit fix` (never `--force`) until the gate passes or {@link MAX_AUDIT_FIX_PASSES} is reached,
 * because a single pass leaves advisories that the next one reaches.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param options - The step's options.
 * @param dependencies - The process runner, the audit and the logger; real ones by default.
 * @returns What changed and whether the audit passes.
 * @throws Error when the directory is not a clean git work tree, or has no root `package.json`.
 * @typeParam None - this function has no generic type parameters.
 */
export function adoptToolchain (repositoryRoot: string, options: ToolchainOptions = {}, dependencies: Partial<ToolchainDependencies> = {}): ToolchainResult {
  const run = dependencies.run ?? runShell
  const capture = dependencies.capture ?? runCapture
  const audit = dependencies.audit ?? ((root: string) => runAudit(root))
  const log = dependencies.log ?? ((message: string) => { console.log(message) })

  requireCleanWorkingTree(repositoryRoot, capture)
  const manifestPath = join(repositoryRoot, 'package.json')
  if (!fileExists(manifestPath)) {
    throw new Error('No package.json at the repository root.')
  }

  log('Removing retired tooling')
  const removed = retireTooling(repositoryRoot)

  const manifest = readJson<{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> } & Record<string, unknown>>(manifestPath)
  const version = chooseNxVersion({ ...manifest.dependencies, ...manifest.devDependencies }, publishedNxVersions(repositoryRoot, capture), options.nxVersion)
  const names: string[] = []
  if (version !== undefined) {
    for (const key of ['dependencies', 'devDependencies'] as const) {
      if (manifest[key] === undefined) {
        continue
      }

      const result = alignNxFamily(manifest[key], version)
      manifest[key] = result.dependencies
      names.push(...result.changed)
    }
    writeFileEnsured(manifestPath, toJson(manifest))
  }

  log('Installing, so the lockfile follows the manifest')
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], repositoryRoot)
  pruneStaleLocalRegistry(repositoryRoot)

  let auditFixes = 0
  let passes = audit(repositoryRoot) === 0
  while (!passes && auditFixes < MAX_AUDIT_FIX_PASSES) {
    auditFixes += 1
    log(`npm audit fix, pass ${auditFixes}`)
    run('npm', ['audit', 'fix', '--no-fund'], repositoryRoot)
    passes = audit(repositoryRoot) === 0
  }

  return { removed, aligned: { names, version }, auditFixes, auditPasses: passes }
}
