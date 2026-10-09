import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { GO_SLICE_CHECK_SCRIPT } from './go-slice-check.config'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'mnci-goslice-'))
  writeFileSync(join(workspace, 'check.cjs'), GO_SLICE_CHECK_SCRIPT)
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

/** Writes empty Go files into the project and runs the check over it. */
function check (files: string[]): { status: number | null, output: string } {
  for (const file of files) {
    mkdirSync(dirname(join(workspace, 'proj', file)), { recursive: true })
    writeFileSync(join(workspace, 'proj', file), 'package x\n')
  }
  mkdirSync(join(workspace, 'proj'), { recursive: true })
  const result = spawnSync(process.execPath, [join(workspace, 'check.cjs'), join(workspace, 'proj')], { encoding: 'utf8' })

  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('the Go slice check (#232)', () => {
  it('passes the layout mnci scaffolds', () => {
    const result = check(['main.go', 'main_test.go', 'hello/greeting_contract.go', 'hello/greet_use_case.go', 'hello/greet_use_case_test.go', 'doc.go', 'hello/doc.go'])

    expect(result.status).toBe(0)
  })

  it('accepts every role, a platform suffix and nested slice folders', () => {
    const result = check(['billing/fee_policy.go', 'billing/ledger_repository.go', 'billing/pdf_client_windows.go', 'billing/invoice_total_algorithm_test.go', 'internal/jobs/run_handler.go'])

    expect(result.status).toBe(0)
  })

  it('rejects a production file at the root that is not doc.go or main.go', () => {
    const result = check(['main.go', 'server.go'])

    expect(result.status).toBe(1)
    expect(result.output).toContain('server.go - only doc.go and main.go sit at the root')
  })

  it('rejects a file with no role, or one that is not snake_case', () => {
    const result = check(['hello/greeter.go', 'hello/greetFee_policy.go'])

    expect(result.status).toBe(1)
    expect(result.output).toContain('hello/greeter.go')
    expect(result.output).toContain('hello/greetFee_policy.go')
  })

  it('rejects a junk-drawer folder, and skips vendor and testdata', () => {
    const result = check(['utils/strings_algorithm.go', 'vendor/x/anything.go', 'testdata/x/anything.go', 'ok/real_use_case.go'])

    expect(result.status).toBe(1)
    expect(result.output).toContain('utils/ - "utils" is a junk drawer')
    expect(result.output).not.toContain('vendor')
    expect(result.output).not.toContain('testdata')
  })

  it('asks for a directory', () => {
    const result = spawnSync(process.execPath, [join(workspace, 'check.cjs')], { encoding: 'utf8' })

    expect(result.status).toBe(1)
  })
})
