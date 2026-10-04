/**
 * `mnci ci verify` must start exactly the Nx commands the inline guard in the generated pipelines does.
 *
 * @remarks
 * The command is a port of a `node -e` one-liner, and a port can drift in a way no unit test
 * of the new code notices. So both run here against the same real git repository, with a
 * stand-in for `npx` that records what it was asked to run, and the recorded commands must
 * be the same in every scenario. Real git, not a fake: what is under test includes how
 * `merge-base` and `fetch` behave when a ref is missing.
 *
 * The one difference is deliberate and is removed before comparing: the command runs
 * `nx sync:check` first, which the pipeline ran as a separate step before the guard.
 */

// Reached through the overlay barrel, which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import spawn from 'cross-spawn'
import { runCiPhase, type CiProcesses } from './ci-pipeline'
import { githubActionsYaml } from './workspace-overlay'

const hasGit = spawnSync('git', ['--version']).status === 0
const describeWithGit = hasGit ? describe : describe.skip
if (!hasGit) {
  console.warn('SKIPPED: verify-phase-parity needs git on PATH')
}

const TARGETS = 'lint,typecheck,test,build'
const INHERITED_BY_THE_HOST = ['GITHUB_BASE_REF', 'SYSTEM_PULLREQUEST_TARGETBRANCH', 'GITHUB_ACTIONS', 'TF_BUILD']

/** The inline guard, taken from the pipeline the generator writes today. */
const guard = (/node -e "[^"]*Pull request against[^"]*"/.exec(githubActionsYaml('ubuntu-latest')) ?? [''])[0]

describeWithGit('the verify phase against the inline guard it replaces', () => {
  let root: string
  let repository: string
  let log: string
  let baseCommit: string

  /** The key PATH goes by here: `Path` on Windows, where a second `PATH` key would be ignored. */
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'

  const git = (...arguments_: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@mnci.invalid', '-c', 'user.name=t', ...arguments_], { cwd: repository, encoding: 'utf8' }).trim()

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-parity-'))
    repository = join(root, 'repo')
    mkdirSync(repository)
    const remote = join(root, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
    git('init', '-q', '-b', 'main')
    writeFileSync(join(repository, 'a.txt'), 'a\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'A')
    baseCommit = git('rev-parse', 'HEAD')
    git('remote', 'add', 'origin', remote.replaceAll('\\', '/'))
    git('push', '-q', 'origin', 'main')
    git('checkout', '-q', '-b', 'feature')
    writeFileSync(join(repository, 'b.txt'), 'b\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'B')

    // A stand-in for npx: records its arguments, one JSON line per call, and succeeds.
    const stub = join(root, 'stub')
    mkdirSync(stub)
    log = join(root, 'npx.log')
    // The log path is written into the stub, not passed in the environment: jest hands the
    // code under test a copy of process.env, so a child it starts does not see a variable
    // set there, while it does find the stub through the PATH the copy carries.
    writeFileSync(join(stub, 'record.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')\n`)
    if (process.platform === 'win32') {
      writeFileSync(join(stub, 'npx.cmd'), '@echo off\r\nnode "%~dp0record.cjs" %*\r\n')
    } else {
      writeFileSync(join(stub, 'npx'), '#!/bin/sh\nexec node "$(dirname "$0")/record.cjs" "$@"\n', { mode: 0o755 })
    }
  }, 60_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** The environment a run starts from: the host's, minus anything that says it is a CI run, plus the stub. */
  function baseEnvironment (): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = { ...process.env, PARITY_LOG: log }
    for (const name of INHERITED_BY_THE_HOST) {
      delete environment[name]
    }
    environment[pathKey] = `${join(root, 'stub')}${delimiter}${process.env[pathKey] ?? ''}`

    return environment
  }

  /** What `npx` was asked to run, after clearing the record. */
  function recorded (): string[][] {
    return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]) : []
  }

  /** Runs the inline guard, the way the pipeline does: through the shell. */
  function runGuard (scenario: NodeJS.ProcessEnv): string[][] {
    rmSync(log, { force: true })
    const result = spawnSync(guard, { cwd: repository, shell: true, encoding: 'utf8', env: { ...baseEnvironment(), ...scenario } })
    // The output is in the assertion, so a failure says why instead of only "1".
    expect({ status: result.status, output: `${result.stdout}${result.stderr}` }).toMatchObject({ status: 0 })

    return recorded()
  }

  /**
   * Runs the command, with real git and the stub `npx`.
   *
   * The processes are given the environment explicitly. Left to the default runner, jest's
   * copy of `process.env` is what they would read, and a child started from it does not
   * get a PATH set there; what is compared is the sequence of commands, and the default
   * runner is a thin wrapper that has its own spec.
   */
  function runCommand (scenario: NodeJS.ProcessEnv): string[][] {
    rmSync(log, { force: true })
    const environment = baseEnvironment()
    const processes: CiProcesses = {
      run:     (command, arguments_) => spawn.sync(command, arguments_, { cwd: repository, env: environment, stdio: 'ignore' }).status ?? 1,
      capture: (command, arguments_) => {
        const result = spawn.sync(command, arguments_, { cwd: repository, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

        return { status: result.status ?? 1, stdout: result.stdout ?? '' }
      },
    }
    const logged: string[] = []
    const status = runCiPhase('verify', repository, { environment: scenario, processes, log: (message) => { logged.push(message) } })
    expect({ status, logged }).toMatchObject({ status: 0 })

    // The command checks the workspace is synced first; the pipeline did that in a step of its own.
    return recorded().filter(call => call[1] !== 'sync:check')
  }

  /** Puts the repository back to what a fresh clone has: the remote-tracking ref present. */
  function restoreOriginMain (): void {
    git('fetch', '-q', '--no-tags', 'origin', 'main:refs/remotes/origin/main')
  }

  it('has an inline guard to compare against', () => {
    expect(guard).toContain('git')
  })

  it('verifies every project on a push, which names no target branch', () => {
    const expected = [['nx', 'run-many', '-t', TARGETS]]

    expect(runGuard({})).toEqual(expected)
    expect(runCommand({})).toEqual(expected)
  })

  it('verifies the affected projects on a pull request, against the merge-base with origin/<target>', () => {
    restoreOriginMain()
    const expected = [['nx', 'affected', '-t', TARGETS, `--base=${baseCommit}`]]

    expect(runGuard({ GITHUB_BASE_REF: 'main' })).toEqual(expected)
    expect(runCommand({ GITHUB_BASE_REF: 'main' })).toEqual(expected)
  })

  it('reads Azure\'s refs/heads/ target the same way', () => {
    restoreOriginMain()
    const expected = [['nx', 'affected', '-t', TARGETS, `--base=${baseCommit}`]]

    expect(runGuard({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' })).toEqual(expected)
    expect(runCommand({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' })).toEqual(expected)
  })

  it('fetches the target and resolves the merge-base from FETCH_HEAD when origin/<target> is missing', () => {
    const expected = [['nx', 'affected', '-t', TARGETS, `--base=${baseCommit}`]]

    git('update-ref', '-d', 'refs/remotes/origin/main')
    const fromGuard = runGuard({ GITHUB_BASE_REF: 'main' })
    git('update-ref', '-d', 'refs/remotes/origin/main')
    const fromCommand = runCommand({ GITHUB_BASE_REF: 'main' })

    expect(fromGuard).toEqual(expected)
    expect(fromCommand).toEqual(expected)
  })

  it('verifies every project when the target cannot be resolved at all', () => {
    const expected = [['nx', 'run-many', '-t', TARGETS]]

    expect(runGuard({ GITHUB_BASE_REF: 'no-such-branch' })).toEqual(expected)
    expect(runCommand({ GITHUB_BASE_REF: 'no-such-branch' })).toEqual(expected)
  })
})
