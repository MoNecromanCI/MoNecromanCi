// Reached through the overlay barrel, which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runVerify } from './verify.use-case'
import type { CiProcesses } from './phase.contract'

const TARGETS = 'lint,typecheck,test,build'

let workspaceRoot: string

/** What `git merge-base <reference> HEAD` answers, by reference. A reference not listed fails. */
type MergeBases = Record<string, string>

interface Harness {
  /** Every command started, in order, as one line. */
  commands:  string[]
  /** Every line logged. */
  logged:    string[]
  /** The recording runner, to hand to the phase. */
  processes: CiProcesses
}

/**
 * Builds a process runner that records what runs and answers like git would.
 *
 * @param mergeBases - The answer for each ref `git merge-base` is asked about.
 * @param statuses - The exit status of a command, keyed by its full line; anything else exits 0.
 */
function harness (mergeBases: MergeBases = {}, statuses: Record<string, number> = {}): Harness {
  const commands: string[] = []
  const logged: string[] = []
  const processes: CiProcesses = {
    run: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      commands.push(line)

      return statuses[line] ?? 0
    },
    capture: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      commands.push(line)
      const reference = arguments_[1]
      const answer = command === 'git' && arguments_[0] === 'merge-base' ? mergeBases[reference] : undefined

      return answer === undefined ? { status: 1, stdout: '' } : { status: 0, stdout: `${answer}\n` }
    },
  }

  return { commands, logged, processes }
}

/** Runs the phase with the recording runner, and returns what it did. */
function verify (environment: NodeJS.ProcessEnv, setup: Harness): number {
  const log = (message: string): void => {
    setup.logged.push(message)
  }

  return runVerify(workspaceRoot, { environment, processes: setup.processes, log })
}

/** Adds an app tagged as needing a C toolchain, which the single-agent verify leaves out. */
function addNativeApp (): void {
  mkdirSync(join(workspaceRoot, 'apps/tray'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'apps/tray/project.json'), JSON.stringify({ tags: ['type:go-app', 'build:cgo'] }))
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-verify-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('runVerify: not a pull request', () => {
  it('verifies every project, after the sync check, so a release is verified in full', () => {
    const run = harness()

    const status = verify({}, run)

    expect(status).toBe(0)
    expect(run.commands).toEqual(['npx nx sync:check', `npx nx run-many -t ${TARGETS}`])
    expect(run.logged).toContain('Not a pull request - verifying EVERY project.')
  })

  it('treats an empty GitHub base ref, which a push sets, as not a pull request', () => {
    const run = harness()

    verify({ GITHUB_BASE_REF: '' }, run)

    expect(run.commands.at(-1)).toBe(`npx nx run-many -t ${TARGETS}`)
  })
})

describe('runVerify: a pull request', () => {
  it('verifies what is affected since the merge-base with origin/<target>', () => {
    const run = harness({ 'origin/main': 'abc123' })

    const status = verify({ GITHUB_BASE_REF: 'main' }, run)

    expect(status).toBe(0)
    expect(run.commands).toEqual([
      'npx nx sync:check',
      'git merge-base origin/main HEAD',
      `npx nx affected -t ${TARGETS} --base=abc123`,
    ])
    expect(run.logged).toContain('Pull request against main - verifying projects affected since abc123')
  })

  it('reads Azure\'s full refs/heads/ target', () => {
    const run = harness({ 'origin/main': 'abc123' })

    verify({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' }, run)

    expect(run.commands).toContain('git merge-base origin/main HEAD')
  })

  it('fetches the target once and retries against FETCH_HEAD when origin/<target> is absent', () => {
    // Without this a missing ref would verify everything while looking selective, for ever.
    const run = harness({ FETCH_HEAD: 'def456' })

    verify({ GITHUB_BASE_REF: 'main' }, run)

    expect(run.commands).toEqual([
      'npx nx sync:check',
      'git merge-base origin/main HEAD',
      'git fetch --no-tags origin main',
      'git merge-base FETCH_HEAD HEAD',
      `npx nx affected -t ${TARGETS} --base=def456`,
    ])
    expect(run.logged).toContain('No origin/main ref - fetching it to resolve a merge-base.')
  })

  it('does not fetch when the ref was there', () => {
    const run = harness({ 'origin/main': 'abc123' })

    verify({ GITHUB_BASE_REF: 'main' }, run)

    expect(run.commands.some(command => command.startsWith('git fetch'))).toBe(false)
  })

  it('verifies every project when no merge-base can be resolved, because a run that verifies too little still reports green', () => {
    const run = harness({})

    verify({ GITHUB_BASE_REF: 'main' }, run)

    expect(run.commands.at(-1)).toBe(`npx nx run-many -t ${TARGETS}`)
    expect(run.logged).toContain('Could not resolve a merge-base with main - verifying EVERY project.')
  })

  it('keeps a branch name with a slash whole', () => {
    const run = harness({ 'origin/release/1.x': 'abc123' })

    verify({ GITHUB_BASE_REF: 'release/1.x' }, run)

    expect(run.commands).toContain(`npx nx affected -t ${TARGETS} --base=abc123`)
  })
})

describe('runVerify: native apps', () => {
  it('leaves them out of the full run, which cannot build them on one agent', () => {
    addNativeApp()
    const run = harness()

    verify({}, run)

    expect(run.commands.at(-1)).toBe(`npx nx run-many -t ${TARGETS} --exclude=tag:build:cgo`)
  })

  it('leaves them out of the affected run too', () => {
    addNativeApp()
    const run = harness({ 'origin/main': 'abc123' })

    verify({ GITHUB_BASE_REF: 'main' }, run)

    expect(run.commands.at(-1)).toBe(`npx nx affected -t ${TARGETS} --base=abc123 --exclude=tag:build:cgo`)
  })

  it('excludes nothing in a workspace with no native app', () => {
    const run = harness()

    verify({}, run)

    expect(run.commands.join('\n')).not.toContain('--exclude')
  })
})

describe('runVerify: failures', () => {
  it('stops at a failing sync check, names the fix, and verifies nothing', () => {
    const run = harness({}, { 'npx nx sync:check': 2 })

    const status = verify({}, run)

    expect(status).toBe(2)
    expect(run.commands).toEqual(['npx nx sync:check'])
    expect(run.logged.some(message => message.includes("run 'npx nx sync'"))).toBe(true)
  })

  it('returns the failing verify command\'s own status, so the pipeline fails with it', () => {
    const run = harness({}, { [`npx nx run-many -t ${TARGETS}`]: 3 })

    expect(verify({}, run)).toBe(3)
  })

  it('returns the affected run\'s status too', () => {
    const run = harness({ 'origin/main': 'abc123' }, { [`npx nx affected -t ${TARGETS} --base=abc123`]: 1 })

    expect(verify({ GITHUB_BASE_REF: 'main' }, run)).toBe(1)
  })
})

describe('runVerify: log groups', () => {
  it('wraps the sync check and the verify run in groups on GitHub', () => {
    const run = harness()

    verify({ GITHUB_ACTIONS: 'true' }, run)

    expect(run.logged.filter(message => message.startsWith('::group::'))).toEqual([
      '::group::Verify the workspace is synced',
      '::group::Verify every project',
    ])
    expect(run.logged.filter(message => message === '::endgroup::')).toHaveLength(2)
  })

  it('uses Azure\'s markers there', () => {
    const run = harness()

    verify({ TF_BUILD: 'True' }, run)

    expect(run.logged).toContain('##[group]Verify the workspace is synced')
    expect(run.logged).toContain('##[endgroup]')
  })

  it('prints plain headings locally, with nothing to close', () => {
    const run = harness()

    verify({}, run)

    expect(run.logged.some(message => message.includes('::') || message.includes('##['))).toBe(false)
    expect(run.logged.some(message => message.includes('Verify every project'))).toBe(true)
  })
})

/** A runner that answers `nx show projects` and records every command. */
function together (all: string[], affected: string[] = [], mergeBase = 'abc123'): { commands: string[], processes: CiProcesses } {
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
        if (command === 'git' && arguments_[0] === 'merge-base') {
          return { status: 0, stdout: `${mergeBase}\n` }
        }
        if (arguments_[0] === 'nx' && arguments_[1] === 'show') {
          return { status: 0, stdout: JSON.stringify(arguments_.includes('--affected') ? affected : all) }
        }

        return { status: 1, stdout: '' }
      },
    },
  }
}

describe('runVerify: linting together', () => {
  beforeEach(() => {
    mkdirSync(join(workspaceRoot, 'packages/a'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'packages/a/package.json'), JSON.stringify({ name: '@x/a' }))
  })

  it('lints the npm projects in one ESLint process and leaves lint out of the Nx run, on a push', () => {
    const { commands, processes } = together(['@x/a', 'gopkg'])

    const status = runVerify(workspaceRoot, { processes, environment: {}, log: () => {} })

    expect(status).toBe(0)
    expect(commands).toContain('npx eslint packages/a --cache')
    expect(commands).toContain('npx nx run-many -t lint --projects=gopkg')
    expect(commands).toContain('npx nx run-many -t typecheck,test,build')
    expect(commands.some(line => line.includes(TARGETS))).toBe(false)
  })

  it('scopes both to the affected projects on a pull request', () => {
    const { commands, processes } = together(['@x/a', 'gopkg'], ['gopkg'])

    runVerify(workspaceRoot, { processes, environment: { GITHUB_BASE_REF: 'main' }, log: () => {} })

    expect(commands.some(line => line.startsWith('npx eslint'))).toBe(false)
    expect(commands).toContain('npx nx run-many -t lint --projects=gopkg')
    expect(commands).toContain('npx nx affected -t typecheck,test,build --base=abc123')
  })

  it('still runs the other targets when ESLint fails, and fails with ESLint\'s status', () => {
    const { processes } = together(['@x/a'])
    const run = jest.fn((command: string, arguments_: string[]) => (arguments_[0] === 'eslint' ? 1 : 0))

    const status = runVerify(workspaceRoot, { processes: { ...processes, run }, environment: {}, log: () => {} })

    expect(status).toBe(1)
    expect(run).toHaveBeenCalledWith('npx', ['nx', 'run-many', '-t', 'typecheck,test,build'])
  })

  it('verifies exactly as before when Nx\'s names cannot be matched with the folders', () => {
    const { commands, processes } = together(['something-else'])

    runVerify(workspaceRoot, { processes, environment: {}, log: () => {} })

    expect(commands).toContain(`npx nx run-many -t ${TARGETS}`)
    expect(commands.some(line => line.startsWith('npx eslint'))).toBe(false)
  })
})
