/**
 * `mnci ci pack` must start exactly the command the inline guard in the generated pipelines does.
 *
 * @remarks
 * The command is a port of a `node -e` one-liner, and a port can drift in a way no unit test
 * of the new code notices. So both run here against the same real workspace, with a stand-in
 * for `npx` that records what it was asked to run, and the recorded commands must be the same
 * in every scenario: no app (a clean skip that starts nothing), and each of the three shapes
 * an app takes (`project.json`, an inline `nx` block, a `.csproj`).
 *
 * The one difference is deliberate and does not reach the comparison: the command wraps the
 * run in a log group, which is log output, not a started command.
 */

// Reached through the overlay barrel, which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import spawn from 'cross-spawn'
import { runCiPhase, type CiProcesses } from './ci-pipeline'
import { githubActionsYaml } from './workspace-overlay'

/** The inline guard, taken from the pipeline the generator writes today. */
const guard = (/node -e "[^"]*No apps to pack[^"]*"/.exec(githubActionsYaml('ubuntu-latest')) ?? [''])[0]

/** Writes a file under the workspace, making its directory first. */
function seed (workspace: string, relative: string, content: string): void {
  const path = join(workspace, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

describe('the pack phase against the inline guard it replaces', () => {
  let root: string
  let stub: string
  let log: string

  /** The key PATH goes by here: `Path` on Windows, where a second `PATH` key would be ignored. */
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-pack-parity-'))
    // A stand-in for npx: records its arguments, one JSON line per call, and succeeds.
    stub = join(root, 'stub')
    mkdirSync(stub)
    log = join(root, 'npx.log')
    writeFileSync(join(stub, 'record.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')\n`)
    if (process.platform === 'win32') {
      writeFileSync(join(stub, 'npx.cmd'), '@echo off\r\nnode "%~dp0record.cjs" %*\r\n')
    } else {
      writeFileSync(join(stub, 'npx'), '#!/bin/sh\nexec node "$(dirname "$0")/record.cjs" "$@"\n', { mode: 0o755 })
    }
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** The environment a run starts from: the host's, with the stub ahead on PATH. */
  function environment (): NodeJS.ProcessEnv {
    return { ...process.env, [pathKey]: `${stub}${delimiter}${process.env[pathKey] ?? ''}` }
  }

  /** A fresh, empty workspace. */
  function freshWorkspace (): string {
    return mkdtempSync(join(root, 'ws-'))
  }

  /** What `npx` was asked to run, after clearing the record. */
  function recorded (): string[][] {
    return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]) : []
  }

  /** Runs the inline guard, the way the pipeline does: through the shell, from the workspace. */
  function runGuard (workspace: string): string[][] {
    rmSync(log, { force: true })
    const result = spawnSync(guard, { cwd: workspace, shell: true, encoding: 'utf8', env: environment() })
    // The output is in the assertion, so a failure says why instead of only "1".
    expect({ status: result.status, output: `${result.stdout}${result.stderr}` }).toMatchObject({ status: 0 })

    return recorded()
  }

  /**
   * Runs the command, with the stub `npx`.
   *
   * The processes are given the environment explicitly: left to the default runner, jest's
   * copy of `process.env` is what a child would read, and the stub set on PATH here would be
   * invisible to it.
   */
  function runCommand (workspace: string): string[][] {
    rmSync(log, { force: true })
    const environment_ = environment()
    const processes: CiProcesses = {
      run:     (command, arguments_) => spawn.sync(command, arguments_, { cwd: workspace, env: environment_, stdio: 'ignore' }).status ?? 1,
      capture: () => ({ status: 1, stdout: '' }),
    }
    const status = runCiPhase('pack', workspace, { processes, log: () => {} })
    expect(status).toBe(0)

    return recorded()
  }

  it('has an inline guard to compare against', () => {
    expect(guard).toContain('run-many')
  })

  it('starts nothing, and skips, when there is no app', () => {
    const guardWorkspace = freshWorkspace()
    const commandWorkspace = freshWorkspace()

    expect(runGuard(guardWorkspace)).toEqual([])
    expect(runCommand(commandWorkspace)).toEqual([])
  })

  it('runs nx run-many -t package for a project.json app', () => {
    const expected = [['nx', 'run-many', '-t', 'package']]
    const guardWorkspace = freshWorkspace()
    seed(guardWorkspace, 'apps/api/project.json', JSON.stringify({ name: 'api' }))
    const commandWorkspace = freshWorkspace()
    seed(commandWorkspace, 'apps/api/project.json', JSON.stringify({ name: 'api' }))

    expect(runGuard(guardWorkspace)).toEqual(expected)
    expect(runCommand(commandWorkspace)).toEqual(expected)
  })

  it('runs it for an inline-nx package.json app, the same way', () => {
    const expected = [['nx', 'run-many', '-t', 'package']]
    const guardWorkspace = freshWorkspace()
    seed(guardWorkspace, 'apps/web/package.json', JSON.stringify({ name: '@demo/web', nx: {} }))
    const commandWorkspace = freshWorkspace()
    seed(commandWorkspace, 'apps/web/package.json', JSON.stringify({ name: '@demo/web', nx: {} }))

    expect(runGuard(guardWorkspace)).toEqual(expected)
    expect(runCommand(commandWorkspace)).toEqual(expected)
  })

  it('runs it for a .csproj app, the same way', () => {
    const expected = [['nx', 'run-many', '-t', 'package']]
    const guardWorkspace = freshWorkspace()
    seed(guardWorkspace, 'apps/service/service.csproj', '<Project />')
    const commandWorkspace = freshWorkspace()
    seed(commandWorkspace, 'apps/service/service.csproj', '<Project />')

    expect(runGuard(guardWorkspace)).toEqual(expected)
    expect(runCommand(commandWorkspace)).toEqual(expected)
  })
})
