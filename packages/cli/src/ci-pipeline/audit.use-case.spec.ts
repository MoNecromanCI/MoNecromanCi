// The phase reaches the process runner through a barrel that loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyNpmAudit, runAudit } from './audit.use-case'
import type { CiProcesses } from './phase.contract'

type Advisory = Parameters<typeof classifyNpmAudit>[0] extends { vulnerabilities?: Record<string, infer A> } ? A : never

/** One advisory. */
function advisory (name: string, severity: string, fixAvailable: Advisory['fixAvailable']): Advisory {
  return { name, severity, fixAvailable }
}

describe('classifyNpmAudit', () => {
  it.each([
    ['a moderate advisory with a plain fix', advisory('a', 'moderate', true), true],
    ['a high advisory with a plain fix', advisory('a', 'high', { isSemVerMajor: false }), true],
    ['a critical advisory with a plain fix', advisory('a', 'critical', true), true],
    ['a low advisory with a fix', advisory('a', 'low', true), false],
    ['a high advisory with no fix upstream', advisory('a', 'high', false), false],
    ['a high advisory whose only fix is a major bump', advisory('a', 'high', { isSemVerMajor: true }), false],
  ])('%s %s block', (_label, found, blocks) => {
    expect(classifyNpmAudit({ vulnerabilities: { a: found } }).blocking).toHaveLength(blocks ? 1 : 0)
  })

  it('says why each advisory that does not block does not', () => {
    const { notes } = classifyNpmAudit({
      vulnerabilities: {
        x: advisory('x', 'high', false),
        y: advisory('y', 'high', { isSemVerMajor: true }),
        z: advisory('z', 'low', true),
      },
    })

    expect(notes).toEqual([
      '  note [high] x - NO fix available upstream, nothing to do here',
      '  note [high] y - only a semver-major change would remove it (often a parent downgrade), not applied automatically',
      '  note [low] z - fix available, below the blocking threshold',
    ])
  })

  it('has nothing to say about a workspace with no advisories', () => {
    expect(classifyNpmAudit({})).toEqual({ blocking: [], total: 0, notes: [] })
  })
})

let workspaceRoot: string

/** A recording runner whose `npm audit --json` prints the given text. */
function harness (auditOutput: string): { commands: string[], logged: string[], processes: CiProcesses } {
  const commands: string[] = []
  const logged: string[] = []
  const processes: CiProcesses = {
    run: (command, arguments_) => {
      commands.push([command, ...arguments_].join(' '))

      return 0
    },
    capture: (command, arguments_) => {
      commands.push([command, ...arguments_].join(' '))

      return { status: 0, stdout: auditOutput }
    },
  }

  return { commands, logged, processes }
}

/** Runs the phase with the recording runner. */
function audit (setup: ReturnType<typeof harness>): number {
  return runAudit(workspaceRoot, { processes: setup.processes, environment: {}, log: message => { setup.logged.push(message) } })
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-audit-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('mnci ci audit (#269)', () => {
  it('passes a clean workspace and says so', () => {
    const setup = harness(JSON.stringify({ vulnerabilities: {} }))

    expect(audit(setup)).toBe(0)

    expect(setup.logged).toContain('npm audit - 0 advisory(ies), none actionable at moderate or above.')
  })

  it('fails on an advisory with a published fix, naming it and the way to fix it', () => {
    const setup = harness(JSON.stringify({ vulnerabilities: { lodash: advisory('lodash', 'high', true) } }))

    expect(audit(setup)).toBe(1)

    expect(setup.logged).toContain('  BLOCKING [high] lodash - fix available')
    expect(setup.logged.some(line => line.includes('overrides entry'))).toBe(true)
  })

  it('does not block on a report that is not JSON: a broken audit must not stop a release', () => {
    const setup = harness('npm error 503 Service Unavailable')

    expect(audit(setup)).toBe(0)

    expect(setup.logged.some(line => line.includes('produced no JSON (exit 0)'))).toBe(true)
  })

  it('skips pip-audit when the workspace has no Python projects', () => {
    const setup = harness('{}')

    audit(setup)

    expect(setup.commands.some(command => command.includes('pip_audit'))).toBe(false)
  })

  it('runs pip-audit for a workspace with Python projects, and never fails on it', () => {
    writeFileSync(join(workspaceRoot, 'requirements-dev.txt'), '')
    const setup = harness('{}')
    const failing: CiProcesses = { ...setup.processes, run: command => (command.startsWith('python') ? 9 : 0) }

    expect(runAudit(workspaceRoot, { processes: failing, environment: {}, log: () => {} })).toBe(0)
  })

  it('does not reach pip-audit when npm audit blocked', () => {
    writeFileSync(join(workspaceRoot, 'requirements-dev.txt'), '')
    const setup = harness(JSON.stringify({ vulnerabilities: { a: advisory('a', 'critical', true) } }))

    expect(audit(setup)).toBe(1)

    expect(setup.commands.some(command => command.includes('pip_audit'))).toBe(false)
  })
})
