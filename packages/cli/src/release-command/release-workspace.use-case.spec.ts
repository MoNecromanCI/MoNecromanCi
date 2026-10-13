// Reached through barrels that load the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))
jest.mock('../terminal', () => ({
  logger:        { step: jest.fn(), info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn(), detail: jest.fn() },
  promptConfirm: jest.fn(),
}))

import { logger } from '../terminal'
import { releaseWorkspace, type ReleaseDependencies } from './release-workspace.use-case'

/** Dependencies for a clean workspace on main; each test overrides what it needs. */
function dependencies (overrides: Partial<ReleaseDependencies> = {}): ReleaseDependencies & { plan: jest.Mock, confirm: jest.Mock } {
  return {
    git:         arguments_ => (arguments_[0] === 'rev-parse' ? { status: 0, stdout: 'main\n' } : { status: 0, stdout: '' }),
    findings:    () => ({ stranded: [], behind: [], untagged: [] }),
    plan:        jest.fn(async () => 0),
    confirm:     jest.fn(async () => true),
    interactive: true,
    ...overrides,
  } as ReleaseDependencies & { plan: jest.Mock, confirm: jest.Mock }
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('releaseWorkspace --dry-run', () => {
  it('shows the plan as a dry run and changes nothing', async () => {
    const deps = dependencies()

    expect(await releaseWorkspace('/ws', { dryRun: true }, deps)).toBe(0)

    expect(deps.plan).toHaveBeenCalledTimes(1)
    expect(deps.plan).toHaveBeenCalledWith(true)
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('fetches the tags first', async () => {
    const git = jest.fn((arguments_: string[]) => ({ status: 0, stdout: arguments_[0] === 'rev-parse' ? 'main\n' : '' }))

    await releaseWorkspace('/ws', { dryRun: true }, dependencies({ git }))

    expect(git.mock.calls[0]?.[0]).toEqual(['fetch', '--tags', '--force', '--quiet'])
  })

  it('shows no plan, and exits non-zero, while a blocker stands', async () => {
    const deps = dependencies({ findings: () => ({ stranded: [], behind: [], untagged: [{ project: '@auto/x', published: '1.0.0' }] }) })

    expect(await releaseWorkspace('/ws', { dryRun: true }, deps)).toBe(1)

    expect(deps.plan).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it('passes a failing plan\'s status through', async () => {
    const deps = dependencies({ plan: jest.fn(async () => 2) })

    expect(await releaseWorkspace('/ws', { dryRun: true }, deps)).toBe(2)
  })
})

describe('releaseWorkspace', () => {
  it('shows the plan, asks, and then releases for real', async () => {
    const deps = dependencies()

    expect(await releaseWorkspace('/ws', {}, deps)).toBe(0)

    expect(deps.plan.mock.calls).toEqual([[true], [false]])
    expect(deps.confirm).toHaveBeenCalledTimes(1)
  })

  it('releases nothing when the answer is no', async () => {
    const deps = dependencies({ confirm: jest.fn(async () => false) })

    expect(await releaseWorkspace('/ws', {}, deps)).toBe(0)

    expect(deps.plan.mock.calls).toEqual([[true]])
  })

  it('asks nothing with --yes', async () => {
    const deps = dependencies()

    await releaseWorkspace('/ws', { yes: true }, deps)

    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.plan.mock.calls).toEqual([[true], [false]])
  })

  it('refuses with no terminal and no --yes', async () => {
    const deps = dependencies({ interactive: false })

    expect(await releaseWorkspace('/ws', {}, deps)).toBe(1)

    expect(deps.plan.mock.calls).toEqual([[true]])
  })

  it('refuses off main, and with a blocker, before planning anything', async () => {
    const offMain = dependencies({ git: arguments_ => ({ status: 0, stdout: arguments_[0] === 'rev-parse' ? 'feat/x\n' : '' }) })
    const stranded = dependencies({ findings: () => ({ stranded: [{ project: '@a/b', oldTag: 'b@1.0.0', newTag: '@a/b@1.0.0' }], behind: [], untagged: [] }) })

    expect(await releaseWorkspace('/ws', { yes: true }, offMain)).toBe(1)
    expect(await releaseWorkspace('/ws', { yes: true }, stranded)).toBe(1)

    expect(offMain.plan).not.toHaveBeenCalled()
    expect(stranded.plan).not.toHaveBeenCalled()
  })
})
