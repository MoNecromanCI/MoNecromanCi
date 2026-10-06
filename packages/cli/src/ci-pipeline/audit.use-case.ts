import { existsSync } from 'node:fs'
import { join } from 'node:path'
import spawn from 'cross-spawn'
import { runShell } from '../nx-workspace'
import { detectCiHost, groupEnd, groupStart } from './ci-environment.client'
import type { CiDependencies } from './phase.contract'

/** What `npm audit --json` reports for one advisory, as far as the gate reads it. */
interface NpmAdvisory {
  name:         string
  severity:     string
  fixAvailable: boolean | { isSemVerMajor?: boolean }
}

/** The severities that block. `low` and `info` are reported and never fail the build. */
const BLOCKING_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'moderate'])

/** The most `npm audit --json` output read: a large workspace's report is far past a child process's default. */
const AUDIT_MAX_BUFFER = 32 * 1024 * 1024

/**
 * Whether the only fix for an advisory is a semver-major change.
 *
 * @param advisory - One advisory.
 * @returns `true` when its fix is a major bump, which is often a parent downgrade.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function onlyMajorFix (advisory: NpmAdvisory): boolean {
  return typeof advisory.fixAvailable === 'object' && advisory.fixAvailable.isSemVerMajor === true
}

/**
 * Decides which advisories block the build, and what to say about the rest.
 *
 * @remarks
 * Blocks on an advisory that has a published fix a plain update can apply, at moderate or above:
 * that is a finding someone can act on. (The phase confirms with `npm audit fix --dry-run` before it
 * blocks, because npm's `fixAvailable` can be true with no change to make.) Everything else passes with a note saying why: no fix
 * exists upstream, only a semver-major change would remove it (not applied automatically), or the
 * severity is below the threshold. A gate that failed on advisories nobody can fix would go red
 * for ever and be ignored. The fix to apply is a targeted `overrides` entry, never `npm audit fix
 * --force`.
 *
 * @param report - The parsed `npm audit --json` output.
 * @param report.vulnerabilities - The advisories by package, absent when there are none.
 * @returns The advisories that block, how many there were in all, and a note per advisory that does not.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function classifyNpmAudit (report: { vulnerabilities?: Record<string, NpmAdvisory> }): { blocking: NpmAdvisory[], total: number, notes: string[] } {
  const all = Object.values(report.vulnerabilities ?? {})
  const blocking = all.filter(advisory => Boolean(advisory.fixAvailable) && BLOCKING_SEVERITIES.has(advisory.severity) && !onlyMajorFix(advisory))
  const notes = all
    .filter(advisory => !blocking.includes(advisory))
    .map(advisory => {
      const why = advisory.fixAvailable
        ? (onlyMajorFix(advisory)
            ? ' - only a semver-major change would remove it (often a parent downgrade), not applied automatically'
            : ' - fix available, below the blocking threshold')
        : ' - NO fix available upstream, nothing to do here'

      return `  note [${advisory.severity}] ${advisory.name}${why}`
    })

  return { blocking, total: all.length, notes }
}

/**
 * Whether `npm audit fix --dry-run --json` has nothing to apply.
 *
 * @remarks
 * npm reports `fixAvailable: true` for an advisory even when no patched release exists anywhere: a
 * dependency chain whose leaf has `first_patched_version: null` (`braces`, in the chain of an unused
 * `verdaccio`) is flagged as fixable, and `npm audit fix` then plans no change at all. Blocking on
 * that is blocking on something nobody can do, and the message would claim a published fix. The
 * plan is the evidence: the reify result lists `add`, `change` and `remove`, and when all three are
 * present and empty there is nothing to act on.
 *
 * Anything else, an output that is not JSON or a plan without those lists, is treated as "may have a
 * plan", so the gate keeps blocking rather than passing on a result it could not read.
 *
 * @param stdout - What the dry run printed.
 * @returns `true` only for a plan that is readable and empty.
 * @throws Never - an unreadable plan is not an empty one.
 * @typeParam None - this function has no generic type parameters.
 */
export function planIsEmpty (stdout: string): boolean {
  try {
    // npm 11 prints the plan as text lines (`change x 1 => 2`) ahead of the JSON document, so read from the first line that opens it.
    const start = stdout.search(/^\{/m)
    const plan = JSON.parse(start === -1 ? stdout : stdout.slice(start)) as { add?: unknown, change?: unknown, remove?: unknown }
    const lists = [plan.add, plan.change, plan.remove]

    return lists.every(list => Array.isArray(list) && list.length === 0)
  } catch {
    return false
  }
}

/**
 * Judges one `npm audit --json` result.
 *
 * @param result - What `npm audit --json` printed and its exit status.
 * @param dryRun - Runs `npm audit fix --dry-run --json`, asked only when something would block.
 * @param log - The logger.
 * @returns 1 when an advisory has a published fix npm can apply, at moderate or above; otherwise 0, including when the report is not JSON.
 * @throws Never - an unreadable report is a pass with a note.
 * @typeParam None - this function has no generic type parameters.
 */
function auditNpm (result: { status: number, stdout: string }, dryRun: () => { status: number, stdout: string }, log: (message: string) => void): number {
  let report: { vulnerabilities?: Record<string, NpmAdvisory> }
  try {
    report = JSON.parse(result.stdout) as typeof report
  } catch {
    log(`npm audit produced no JSON (exit ${result.status}) - not blocking on a broken audit.`)

    return 0
  }
  const { blocking, total, notes } = classifyNpmAudit(report)
  for (const note of notes) {
    log(note)
  }
  if (blocking.length === 0) {
    log(`npm audit - ${total} advisory(ies), none actionable at moderate or above.`)

    return 0
  }
  if (planIsEmpty(dryRun().stdout)) {
    for (const advisory of blocking) {
      log(`  note [${advisory.severity}] ${advisory.name} - npm reports a fix, but npm audit fix has nothing to apply`)
    }
    log(`npm audit - ${total} advisory(ies); ${blocking.length} reported as fixable, but no patched release is reachable, so there is nothing to do here.`)

    return 0
  }
  for (const advisory of blocking) {
    log(`  BLOCKING [${advisory.severity}] ${advisory.name} - fix available`)
  }
  log('Each has a published fix. Add a targeted overrides entry in package.json rather than npm audit fix --force.')

  return 1
}

/**
 * Runs the audit phase: `npm audit`, which blocks, then `pip-audit`, which only reports.
 *
 * @remarks
 * A port of the two audit steps of the generated pipelines. `npm audit` fails the run for an
 * advisory with a published fix (see {@link classifyNpmAudit}); a report that is not JSON does not
 * block, because a broken audit service must not stop a release. `pip-audit` runs only when the
 * workspace has Python projects, against the environment `setup` filled, and its exit status is
 * discarded: unlike npm, its output carries no "a fix exists" field, so an advisory nobody can act
 * on cannot be told from one someone can. Do not make it blocking to match npm; that trades a weak
 * gate for a false one.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The environment, the process runner and the logger; real ones by default.
 * @returns 0 unless an actionable npm advisory exists, then 1.
 * @throws Never - a command that fails is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export function runAudit (workspaceRoot: string, dependencies: Partial<CiDependencies> = {}): number {
  const environment = dependencies.environment ?? process.env
  const processes = dependencies.processes ?? {
    run:     (command, arguments_) => runShell(command, arguments_, workspaceRoot),
    capture: (command, arguments_) => {
      const result = spawn.sync(command, arguments_, { cwd: workspaceRoot, encoding: 'utf8', maxBuffer: AUDIT_MAX_BUFFER })

      return { status: result.status ?? 1, stdout: result.stdout ?? '' }
    },
  }
  const log = dependencies.log ?? ((message: string) => { console.log(message) })
  const host = detectCiHost(environment)

  const closeGroup = (): void => {
    const closing = groupEnd(host)
    if (closing !== undefined) {
      log(closing)
    }
  }

  log(groupStart(host, 'npm audit'))
  const npm = auditNpm(processes.capture('npm', ['audit', '--json']), () => processes.capture('npm', ['audit', 'fix', '--dry-run', '--json']), log)
  closeGroup()
  if (npm !== 0) {
    return npm
  }

  if (!existsSync(join(workspaceRoot, 'requirements-dev.txt'))) {
    return 0
  }
  log(groupStart(host, 'pip-audit (non-blocking)'))
  processes.run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip_audit'])
  closeGroup()

  return 0
}
