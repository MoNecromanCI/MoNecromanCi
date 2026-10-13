import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { planLint, runLintPlan, type LintProcesses } from './lint-together.use-case'

let root: string

/** Writes a file under the workspace. */
function seed (relative: string, contents: unknown): void {
  mkdirSync(dirname(join(root, relative)), { recursive: true })
  writeFileSync(join(root, relative), JSON.stringify(contents))
}

/** A runner whose `nx show projects` answers come from a table keyed by whether `--affected` was passed. */
function processes (answers: { all?: string[], affected?: string[] }, commands: string[] = []): LintProcesses {
  return {
    run: (command, arguments_) => {
      commands.push([command, ...arguments_].join(' '))

      return 0
    },
    capture: (command, arguments_) => {
      commands.push(`capture: ${[command, ...arguments_].join(' ')}`)
      const list = arguments_.includes('--affected') ? answers.affected : answers.all

      return list === undefined ? { status: 1, stdout: '' } : { status: 0, stdout: JSON.stringify(list) }
    },
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-lint-'))
  seed('packages/a/package.json', { name: '@x/a' })
  seed('packages/b/package.json', { name: '@x/b' })
  seed('packages/site/package.json', { name: '@x/site' })
  seed('packages/site/project.json', { targets: { lint: { options: { command: 'astro check' } } } })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('planLint', () => {
  it('puts the npm projects with ESLint together and every other lint target with Nx', () => {
    const plan = planLint(root, processes({ all: ['@x/a', '@x/b', '@x/site', 'gopkg', '@x/source'] }))

    expect(plan?.eslint.map(project => project.name)).toEqual(['@x/a', '@x/b'])
    expect(plan?.nx).toEqual(['@x/site', 'gopkg', '@x/source'])
  })

  it('gives up, so the caller lints through Nx, when a name on disk is not one Nx knows', () => {
    expect(planLint(root, processes({ all: ['@x/a', '@x/site'] }))).toBeUndefined()
  })

  it('gives up when Nx cannot answer, or there is no npm project', () => {
    expect(planLint(root, processes({}))).toBeUndefined()
    rmSync(join(root, 'packages'), { recursive: true, force: true })
    expect(planLint(root, processes({ all: ['gopkg'] }))).toBeUndefined()
  })

  it('scopes both lists to the affected projects, and still checks every name against the full list', () => {
    const commands: string[] = []
    const plan = planLint(root, processes({ all: ['@x/a', '@x/b', '@x/site', 'gopkg'], affected: ['@x/b', 'gopkg'] }, commands), { base: 'abc123' })

    expect(plan?.eslint.map(project => project.name)).toEqual(['@x/b'])
    expect(plan?.nx).toEqual(['gopkg'])
    expect(commands.some(line => line.includes('--affected') && line.includes('--base=abc123'))).toBe(true)
  })

  it('passes native-app exclusions to Nx', () => {
    const commands: string[] = []

    planLint(root, processes({ all: ['@x/a', '@x/b', '@x/site'] }, commands), { exclude: ['tag:release:go'] })

    expect(commands[0]).toContain('--exclude=tag:release:go')
  })
})

describe('runLintPlan', () => {
  it('runs one ESLint process over the folders, then Nx over the rest', () => {
    const commands: string[] = []
    const plan = planLint(root, processes({ all: ['@x/a', '@x/b', '@x/site'] }))

    expect(runLintPlan(plan!, processes({}, commands), () => {})).toBe(0)

    expect(commands).toEqual([
      'npx eslint packages/a packages/b --cache',
      'npx nx run-many -t lint --projects=@x/site',
    ])
  })

  it('runs both halves even when ESLint fails, and returns the first failing status', () => {
    const commands: string[] = []
    const failing: LintProcesses = {
      run: (command, arguments_) => {
        commands.push([command, ...arguments_].join(' '))

        return arguments_[0] === 'eslint' ? 1 : 2
      },
      capture: () => ({ status: 1, stdout: '' }),
    }

    const status = runLintPlan({ eslint: [{ name: '@x/a', dir: 'packages/a' }], nx: ['gopkg'] }, failing, () => {})

    expect(status).toBe(1)
    expect(commands).toHaveLength(2)
  })

  it('has nothing to run for an empty plan', () => {
    expect(runLintPlan({ eslint: [], nx: [] }, processes({}), () => {})).toBe(0)
  })
})
