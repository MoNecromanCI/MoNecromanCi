import type { RepositoryFacts } from './adoption-report.contract'
import { judgeAdoption } from './judge-adoption.policy'

const healthy: RepositoryFacts = {
  isGitRepo:        true,
  dirty:            false,
  packageManager:   'npm',
  nxVersion:        '23.3.0',
  alreadyMnci:      false,
  projects:         [{ name: 'a', dir: 'packages/a', ecosystem: 'npm' }],
  tagCount:         0,
  strandedTags:     [],
  ci:               [],
  pipelineUsesMnci: false,
  retiredTooling:   [],
  personalFiles:    [],
}

describe('judgeAdoption', () => {
  it('is ready, with nothing to say, for a clean npm repository with projects', () => {
    expect(judgeAdoption(healthy)).toEqual({ ready: true, facts: healthy, findings: [] })
  })

  it.each([
    ['not a git repository', { isGitRepo: false }, 'not a git repository'],
    ['uncommitted changes', { dirty: true }, 'uncommitted changes'],
    ['another package manager', { packageManager: 'pnpm' as const }, 'pnpm'],
    ['no projects', { projects: [] }, 'no project manifest'],
  ])('blocks on %s, and names the way out', (_label, change, text) => {
    const report = judgeAdoption({ ...healthy, ...change })

    expect(report.ready).toBe(false)
    expect(report.findings[0]).toMatchObject({ severity: 'blocker' })
    expect(report.findings[0].detail).toContain(text)
    expect(report.findings[0].step.length).toBeGreaterThan(0)
  })

  it('warns about what a later step clears, and lists blockers first', () => {
    const report = judgeAdoption({
      ...healthy,
      dirty:          true,
      nxVersion:      undefined,
      strandedTags:   [{ project: '@a/x', oldTag: 'x@1.0.0', newTag: '@a/x@1.0.0' }],
      retiredTooling: ['.prettierrc'],
      ci:             ['azure'],
      personalFiles:  ['CLAUDE.md'],
    })

    expect(report.findings.map(finding => finding.severity)).toEqual(['blocker', 'warning', 'warning', 'warning', 'warning', 'warning'])
  })

  it('does not block on warnings alone', () => {
    expect(judgeAdoption({ ...healthy, retiredTooling: ['.prettierrc'], ci: ['azure'] }).ready).toBe(true)
  })

  it('sends an existing mnci workspace to upgrade', () => {
    const report = judgeAdoption({ ...healthy, alreadyMnci: true })

    expect(report.ready).toBe(true)
    expect(report.findings[0].step).toContain('mnci upgrade')
  })
})
