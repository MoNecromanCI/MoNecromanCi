/**
 * `mnci ci audit` must judge `npm audit` exactly as the inline guard in the generated pipelines does.
 *
 * @remarks
 * The phase is a port of a `node -e` one-liner, and a port can drift in a way no unit test of the new
 * code notices: a severity moved across the line, a note worded differently, an exit status flipped.
 * So both run here against the same canned `npm audit --json` output, the old one as the real guard
 * the generator writes today with a stand-in `npm` that prints the fixture, the new one with the
 * same fixture handed to its runner, and in every scenario the exit status and the lines that carry a
 * verdict must be the same. Log-group markers are not compared: they are the one deliberate addition.
 */

// Reached through the overlay barrel, which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { runCiPhase } from './ci-pipeline'
import { githubActionsYaml } from './workspace-overlay'

/** The inline guard, taken from the pipeline the generator writes today. */
const guard = (/node -e "const cp=require\('node:child_process'\);const r=cp\.spawnSync\('npm',\['audit'[^"]*"/.exec(githubActionsYaml('ubuntu-latest')) ?? [''])[0]

/** The lines that carry a verdict, which is all the comparison reads. */
const VERDICT = /^(?: {2}note | {2}BLOCKING |npm audit|Each has )/

/** One advisory in an `npm audit --json` report. */
function advisory (name: string, severity: string, fixAvailable: unknown): [string, unknown] {
  return [name, { name, severity, fixAvailable }]
}

const SCENARIOS: Array<[string, string]> = [
  ['a clean workspace', JSON.stringify({ vulnerabilities: {} })],
  ['an advisory with a plain fix at moderate', JSON.stringify({ vulnerabilities: Object.fromEntries([advisory('a', 'moderate', true)]) })],
  ['an advisory with a plain fix at high, as an object', JSON.stringify({ vulnerabilities: Object.fromEntries([advisory('a', 'high', { isSemVerMajor: false })]) })],
  ['an advisory with a plain fix at critical', JSON.stringify({ vulnerabilities: Object.fromEntries([advisory('a', 'critical', true)]) })],
  ['an advisory with a plain fix below the threshold', JSON.stringify({ vulnerabilities: Object.fromEntries([advisory('a', 'low', true)]) })],
  ['an advisory with no fix upstream', JSON.stringify({ vulnerabilities: Object.fromEntries([advisory('a', 'critical', false)]) })],
  ['an advisory whose only fix is a major bump', JSON.stringify({ vulnerabilities: Object.fromEntries([advisory('a', 'high', { isSemVerMajor: true })]) })],
  ['a mix of blocking and non-blocking advisories', JSON.stringify({
    vulnerabilities: Object.fromEntries([
      advisory('blocks', 'high', true), advisory('nofix', 'high', false), advisory('major', 'moderate', { isSemVerMajor: true }), advisory('minor', 'low', true),
    ]),
  })],
  ['a report with no vulnerabilities field', JSON.stringify({})],
  ['output that is not JSON', 'npm error 503 Service Unavailable'],
]

describe('the audit phase against the inline guard it replaces', () => {
  let root: string
  let stub: string

  /** The key PATH goes by here: `Path` on Windows, where a second `PATH` key would be ignored. */
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-audit-parity-'))
    // A stand-in for npm: prints the canned report named by AUDIT_FIXTURE and succeeds.
    stub = join(root, 'stub')
    mkdirSync(stub)
    writeFileSync(join(stub, 'print.cjs'), "process.stdout.write(process.env.AUDIT_FIXTURE ?? '')\n")
    if (process.platform === 'win32') {
      writeFileSync(join(stub, 'npm.cmd'), '@echo off\r\nnode "%~dp0print.cjs"\r\n')
    } else {
      writeFileSync(join(stub, 'npm'), '#!/bin/sh\nexec node "$(dirname "$0")/print.cjs"\n', { mode: 0o755 })
    }
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('found the inline guard to compare against', () => {
    expect(guard).toContain('BLOCKING')
  })

  it.each(SCENARIOS)('agrees on %s', (_label, fixture) => {
    const old = spawnSync(guard, {
      cwd: root, shell: true, encoding: 'utf8', env: { ...process.env, AUDIT_FIXTURE: fixture, [pathKey]: `${stub}${delimiter}${process.env[pathKey] ?? ''}` },
    })
    const logged: string[] = []
    const status = runCiPhase('audit', root, {
      environment: {},
      log:         message => { logged.push(message) },
      processes:   { run: () => 0, capture: () => ({ status: 0, stdout: fixture }) },
    })

    expect(status).toBe(old.status)
    expect(logged.filter(line => VERDICT.test(line))).toEqual(old.stdout.split(/\r?\n/).filter(line => VERDICT.test(line)))
  })
})
