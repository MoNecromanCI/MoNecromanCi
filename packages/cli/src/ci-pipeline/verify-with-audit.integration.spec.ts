// Reached through the overlay barrel (pinned tool versions), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runVerifyWithAudit } from './verify-with-audit.use-case'
import type { CiProcesses } from './phase.contract'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-verify-'))
  writeFileSync(join(workspaceRoot, 'package.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package-lock.json'), '{}')
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

/** A runner that records every command and answers `audit` with the given report. */
function recorder (auditReport: string): { commands: string[], processes: CiProcesses } {
  const commands: string[] = []

  return {
    commands,
    processes: {
      run: (command, arguments_) => {
        commands.push([command, ...arguments_].join(' '))

        return 0
      },
      capture: (command, arguments_) => {
        commands.push(`capture: ${[command, ...arguments_].join(' ')}`)

        return { status: 0, stdout: arguments_.includes('audit') ? auditReport : '' }
      },
    },
  }
}

/** The report of one production advisory that has a published fix. */
const ACTIONABLE = JSON.stringify({
  vulnerabilities: { lodash: { name: 'lodash', severity: 'high', isDirect: true, fixAvailable: true, via: [{ title: 'x', url: 'https://example.com' }] } },
  metadata:        { vulnerabilities: { high: 1, total: 1 } },
})

describe('mnci ci verify includes the audit gate', () => {
  it('audits before it verifies anything', async () => {
    const { commands, processes } = recorder(JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }))

    runVerifyWithAudit(workspaceRoot, { processes, environment: {}, log: () => {} })

    const audit = commands.findIndex(line => line.includes('audit'))
    const sync = commands.indexOf('npx nx sync:check')
    expect(audit).toBeGreaterThanOrEqual(0)
    expect(sync).toBeGreaterThan(audit)
  })

  it('stops on an actionable advisory without running the verification', async () => {
    const { commands, processes } = recorder(ACTIONABLE)

    const status = runVerifyWithAudit(workspaceRoot, { processes, environment: {}, log: () => {} })

    expect(status).toBe(1)
    expect(commands).not.toContain('npx nx sync:check')
  })
})
