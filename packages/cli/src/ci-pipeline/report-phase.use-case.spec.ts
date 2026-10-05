import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportPhase } from './report-phase.use-case'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mnci-report-'))
})

afterEach(() => {
  rmSync(directory, { force: true, recursive: true })
})

/** A clock that reads each of `readings` in turn. */
function clockOf (...readings: number[]): () => number {
  const queue = [...readings]

  return () => queue.shift() ?? 0
}

/** A phase that throws, as a bug in one would. */
const explode = (): number => {
  throw new Error('boom')
}

describe('reportPhase', () => {
  it('returns the status, and logs how long a passing phase took', async () => {
    const lines: string[] = []

    const status = await reportPhase('verify', () => 0, { environment: {}, log: line => { lines.push(line) }, clock: clockOf(1000, 4100) })

    expect(status).toBe(0)
    expect(lines).toEqual(['mnci ci verify: passed in 3.1s'])
  })

  it('waits for a phase that returns a promise', async () => {
    const lines: string[] = []

    const status = await reportPhase('release', async () => 0, { environment: {}, log: line => { lines.push(line) }, clock: clockOf(0, 2000) })

    expect(status).toBe(0)
    expect(lines[0]).toContain('passed in 2.0s')
  })

  it('annotates a failure on GitHub and passes the status through', async () => {
    const lines: string[] = []

    const status = await reportPhase('pack', () => 2, { environment: { GITHUB_ACTIONS: 'true' }, log: line => { lines.push(line) }, clock: clockOf(0, 500) })

    expect(status).toBe(2)
    expect(lines).toEqual([
      'mnci ci pack: failed (exit 2) in 0.5s',
      '::error title=mnci ci pack::The pack phase failed with exit status 2 after 0.5s',
    ])
  })

  it('appends a line to the GitHub run summary, once per phase', async () => {
    const summary = join(directory, 'summary.md')
    writeFileSync(summary, '')
    const environment = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary }

    await reportPhase('verify', () => 0, { environment, log: () => {}, clock: clockOf(0, 64_000) })
    await reportPhase('pack', () => 1, { environment, log: () => {}, clock: clockOf(0, 1000) })

    expect(readFileSync(summary, 'utf8')).toBe('- ✅ **verify** passed in 1m 04s\n- ❌ **pack** failed (exit 1) after 1.0s\n')
  })

  it('writes no summary file elsewhere, even when the variable is set', async () => {
    const summary = join(directory, 'summary.md')

    await reportPhase('verify', () => 0, { environment: { TF_BUILD: 'True', GITHUB_STEP_SUMMARY: summary }, log: () => {}, clock: clockOf(0, 1) })

    expect(() => readFileSync(summary)).toThrow()
  })

  it('reports a phase that throws as failed, and rethrows', async () => {
    const lines: string[] = []

    const dependencies = { environment: {}, log: (line: string) => { lines.push(line) }, clock: clockOf(0, 100) }

    await expect(reportPhase('audit', explode, dependencies)).rejects.toThrow('boom')

    expect(lines).toEqual(['mnci ci audit: failed (exit 1) in 0.1s'])
  })
})
