import { logger, printJson } from '../terminal'
import type { UpgradeOptions } from '../workspace-upgrade'
import { adoptOverlay } from './adopt-overlay.use-case'
import { adoptToolchain } from './adopt-toolchain.use-case'
import { createBaselineTags } from './create-baseline-tags.use-case'
import type { AdoptionReport } from './adoption-report.contract'
import { inspectRepository } from './inspect-repository.use-case'
import { judgeAdoption } from './judge-adoption.policy'

/**
 * Flags of `mnci adopt`.
 *
 * @remarks
 * The report is the default; each step that changes something is its own flag.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface AdoptOptions extends UpgradeOptions {
  /** Print the report as one JSON document, for an editor or a script. */
  json?:      boolean
  /** Create, locally, the baseline tags for projects whose release tags are stranded under an old name. */
  tags?:      boolean
  /** Retire old tooling, align the Nx family and make the audit pass; leaves the changes uncommitted. */
  toolchain?: boolean
  /** The Nx version `toolchain` aligns to. */
  nx?:        string
}

/**
 * Reads a repository and says what adopting it into mnci would involve.
 *
 * @remarks
 * Pure of side effects: it reads git and the filesystem and prints nothing, so a test or an editor can call it.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @returns The report.
 * @throws Error when a manifest it must read is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function reportAdoption (repositoryRoot: string): AdoptionReport {
  return judgeAdoption(inspectRepository(repositoryRoot))
}

/**
 * Prints the adoption report. Read-only.
 *
 * @remarks
 * Exits non-zero (`process.exitCode`, so output is never cut short) when a blocker stands in the way,
 * the same contract as `mnci doctor`. With `--json`, stdout is the report and nothing else.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Error when a manifest it must read is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function runAdopt (repositoryRoot: string, options: AdoptOptions = {}): void {
  const report = reportAdoption(repositoryRoot)
  if (options.overlay === true) {
    runOverlay(repositoryRoot, options)

    return
  }
  if (options.toolchain === true) {
    runToolchain(repositoryRoot, options)

    return
  }
  if (options.tags === true) {
    runBaselineTags(repositoryRoot, report)

    return
  }
  if (!report.ready) {
    process.exitCode = 1
  }
  if (options.json === true) {
    printJson(report)

    return
  }
  const { facts } = report
  logger.info(`${facts.projects.length} project(s), ${facts.tagCount} tag(s), ${facts.packageManager ?? 'no lockfile'}, nx ${facts.nxVersion ?? 'not installed'}`)
  for (const finding of report.findings) {
    const line = `${finding.severity === 'blocker' ? 'BLOCKER' : 'warning'}: ${finding.detail}\n    next: ${finding.step}`
    if (finding.severity === 'blocker') {
      logger.error(line)
    } else {
      logger.warn(line)
    }
  }
  if (report.ready) {
    logger.success('Nothing blocks adoption. This was a read-only report; nothing was changed.')
  } else {
    logger.error('Adoption is blocked. Clear the blockers above and run the report again.')
  }
}

/**
 * Creates the baseline tags for the stranded projects and says how to publish them.
 *
 * @remarks
 * Local only. The push is printed, not run: it changes the remote, so it stays the person's decision.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param report - The adoption report, whose facts name the stranded projects.
 * @returns Nothing.
 * @throws Never - a refused tag is reported and sets the exit code.
 * @typeParam None - this function has no generic type parameters.
 */
function runBaselineTags (repositoryRoot: string, report: AdoptionReport): void {
  if (!report.facts.isGitRepo) {
    logger.error('This directory is not a git repository, so there are no tags to baseline.')
    process.exitCode = 1

    return
  }
  const { strandedTags } = report.facts
  if (strandedTags.length === 0) {
    logger.success('No project has release tags stranded under an old name. Nothing to baseline.')

    return
  }
  const result = createBaselineTags(repositoryRoot, strandedTags)
  for (const tag of result.created) {
    logger.success(`created ${tag}`)
  }
  for (const tag of result.existing) {
    logger.info(`${tag} already exists, left alone`)
  }
  for (const tag of result.failed) {
    logger.error(`could not create ${tag}: its old tag does not resolve to a commit`)
  }
  if (result.failed.length > 0) {
    process.exitCode = 1
  }
  if (result.created.length > 0) {
    logger.info(`Local only. Publish them when you are ready: git push origin ${result.created.map(tag => JSON.stringify(tag)).join(' ')}`)
    logger.info('A tag made under the new name at a LOWER version (for example @scope/x@0.0.5) stays; the baseline outranks it, and removing it from the remote is your call.')
  }
}

/**
 * Runs the toolchain step and says what it changed and what to do next.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Never - a refusal is printed and sets the exit code.
 * @typeParam None - this function has no generic type parameters.
 */
function runToolchain (repositoryRoot: string, options: AdoptOptions): void {
  try {
    const result = adoptToolchain(repositoryRoot, { nxVersion: options.nx }, { log: message => { logger.step(message) } })
    for (const line of result.removed) {
      logger.info(`removed ${line}`)
    }
    if (result.aligned.version === undefined) {
      logger.info('Nx is not declared at the root, so there is no family to align.')
    } else {
      logger.info(`Nx family at ${result.aligned.version}${result.aligned.names.length > 0 ? ` (moved: ${result.aligned.names.join(', ')})` : ' (already aligned)'}`)
    }
    if (result.auditPasses) {
      logger.success(`The audit gate passes${result.auditFixes > 0 ? ` after ${result.auditFixes} npm audit fix pass(es)` : ''}. Review with \`git diff\` and commit package.json and package-lock.json.`)
    } else {
      logger.error('The audit gate still fails after npm audit fix. Run `mnci ci audit` to see what is left; a targeted overrides entry is the usual answer.')
      process.exitCode = 1
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

/**
 * Applies the overlay and says what to check next.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param options - The command's flags, which include everything `mnci upgrade` takes.
 * @returns Nothing.
 * @throws Never - a refusal is printed and sets the exit code.
 * @typeParam None - this function has no generic type parameters.
 */
function runOverlay (repositoryRoot: string, options: AdoptOptions): void {
  try {
    adoptOverlay(repositoryRoot, options)
    logger.info('Steps of your old pipeline that mnci does not recognise are in its slots (# mnci:slot); anything it could not carry over was listed above.')
    logger.info('Run `mnci doctor` to confirm the verify phase is active, then review with `git diff`.')
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
