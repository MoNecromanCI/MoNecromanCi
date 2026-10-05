/**
 * `mnci ci setup` must install the Python projects with exactly the command the inline guard does.
 *
 * @remarks
 * Almost every setup step is one fixed command, but the Python workspace install builds its argument
 * list from globs (which projects are editable, which Azure Function apps install from requirements,
 * in which order), and that is where a port drifts without a unit test noticing. So both run here
 * against the same workspace, with a stand-in interpreter that records the arguments it was given, and
 * the recorded commands must be the same in every scenario.
 *
 * Not run on Windows: the inline guard starts `python` without a shell, which cannot see a `.cmd`
 * stand-in and would run the machine's real pip against the empty fixtures. The Linux job runs it, where
 * a shell-script stand-in is found by either side. The phase itself starts the interpreter through
 * `cross-spawn`, which does handle `.cmd`, so it has no such limit.
 */

// Reached through the overlay barrel, which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import spawn from 'cross-spawn'
import { runCiPhase } from './ci-pipeline'
import { githubActionsYaml } from './workspace-overlay'

/** The inline guard, taken from the pipeline the generator writes today. */
const guard = (/node -e "const fs=require\('node:fs'\),path=require\('node:path'\);const editableDirs[^"]*"/.exec(githubActionsYaml('ubuntu-latest')) ?? [''])[0]

/** What each scenario's workspace holds. */
const SCENARIOS: Array<[string, string[]]> = [
  ['no Python project', []],
  ['one app', ['apps/api/pyproject.toml']],
  ['an app, a package and an internal library', ['apps/api/pyproject.toml', 'python-packages/core/pyproject.toml', 'libs/shared/pyproject.toml']],
  ['an Azure Function app installed from requirements', ['apps/fn/requirements.txt']],
  ['every shape together', ['apps/a/pyproject.toml', 'apps/b/pyproject.toml', 'python-packages/p/pyproject.toml', 'libs/l/pyproject.toml', 'apps/fn/requirements.txt']],
]

const describeWhereTheGuardCanBeStubbed = process.platform === 'win32' ? describe.skip : describe

describeWhereTheGuardCanBeStubbed('the setup phase against the inline guard it replaces', () => {
  let root: string
  let stub: string
  let log: string
  const pythonName = process.platform === 'win32' ? 'python' : 'python3'

  /** The key PATH goes by here: `Path` on Windows, where a second `PATH` key would be ignored. */
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-setup-parity-'))
    // A stand-in interpreter: records its arguments, one JSON line per call, and succeeds.
    stub = join(root, 'stub')
    mkdirSync(stub)
    log = join(root, 'python.log')
    writeFileSync(join(stub, 'record.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')\n`)
    if (process.platform === 'win32') {
      writeFileSync(join(stub, `${pythonName}.cmd`), '@echo off\r\nnode "%~dp0record.cjs" %*\r\n')
    } else {
      writeFileSync(join(stub, pythonName), '#!/bin/sh\nexec node "$(dirname "$0")/record.cjs" "$@"\n', { mode: 0o755 })
    }
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** A fresh workspace holding the given files. */
  function workspace (files: string[]): string {
    const directory = mkdtempSync(join(root, 'ws-'))
    for (const file of files) {
      mkdirSync(join(directory, file, '..'), { recursive: true })
      writeFileSync(join(directory, file), '')
    }

    return directory
  }

  /** What the stand-in interpreter was asked to run since the last read. */
  function recorded (): string[][] {
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]) : []
    rmSync(log, { force: true })

    return calls
  }

  it('found the inline guard to compare against', () => {
    expect(guard).toContain('editableDirs')
  })

  it.each(SCENARIOS)('starts the same install for %s', async (_label, files) => {
    const environment = { ...process.env, [pathKey]: `${stub}${delimiter}${process.env[pathKey] ?? ''}` }
    const old = workspace(files)
    spawnSync(guard, { cwd: old, shell: true, encoding: 'utf8', env: environment })
    const fromGuard = recorded()

    const fresh = workspace(files)
    // Only the Python install is under test: a workspace holding just Python projects runs exactly that step.
    // The environment is handed to the child explicitly, as it is to the guard: jest gives a test its own
    // copy of process.env, so changing PATH there would never reach a real child process.
    const status = await runCiPhase('setup', fresh, {
      environment: {},
      log:         () => {},
      processes:   {
        run:     (command, arguments_) => spawn.sync(command, arguments_, { cwd: fresh, stdio: 'inherit', env: environment }).status ?? 1,
        capture: () => ({ status: 1, stdout: '' }),
      },
    })
    const fromPhase = recorded()

    expect(status).toBe(0)

    expect(fromPhase).toEqual(fromGuard)
  })
})
