import { detectCiHost, groupEnd, groupStart, pullRequestTarget } from './ci-environment.client'

describe('detectCiHost', () => {
  it('recognises GitHub Actions by the variable it sets on every run', () => {
    expect(detectCiHost({ GITHUB_ACTIONS: 'true' })).toBe('github')
  })

  it('recognises Azure Pipelines by TF_BUILD', () => {
    expect(detectCiHost({ TF_BUILD: 'True' })).toBe('azure')
  })

  it('is local when neither is set, or when they are set to something that is not a run', () => {
    expect(detectCiHost({})).toBe('local')
    expect(detectCiHost({ GITHUB_ACTIONS: 'false' })).toBe('local')
    expect(detectCiHost({ TF_BUILD: '' })).toBe('local')
  })
})

describe('pullRequestTarget', () => {
  it('reads GitHub\'s base ref', () => {
    expect(pullRequestTarget({ GITHUB_BASE_REF: 'main' })).toBe('main')
  })

  it('reads Azure\'s target branch and strips the refs/heads/ prefix it sends', () => {
    expect(pullRequestTarget({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/release/1.x' })).toBe('release/1.x')
  })

  it('is not a pull request when GitHub sets the base ref to an empty string, as it does on a push', () => {
    expect(pullRequestTarget({ GITHUB_BASE_REF: '' })).toBeUndefined()
  })

  it('is not a pull request when nothing is set', () => {
    expect(pullRequestTarget({})).toBeUndefined()
  })

  it('prefers GitHub\'s variable when both are present, like the inline guard it replaces', () => {
    expect(pullRequestTarget({ GITHUB_BASE_REF: 'main', SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/other' })).toBe('main')
  })

  it('falls through an empty GitHub value to Azure\'s', () => {
    expect(pullRequestTarget({ GITHUB_BASE_REF: '', SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' })).toBe('main')
  })
})

describe('log groups', () => {
  it('opens and closes a collapsible group on GitHub', () => {
    expect(groupStart('github', 'Verify')).toBe('::group::Verify')
    expect(groupEnd('github')).toBe('::endgroup::')
  })

  it('opens and closes one on Azure', () => {
    expect(groupStart('azure', 'Verify')).toBe('##[group]Verify')
    expect(groupEnd('azure')).toBe('##[endgroup]')
  })

  it('prints a plain heading locally, which needs no closing line', () => {
    expect(groupStart('local', 'Verify')).toContain('Verify')
    expect(groupStart('local', 'Verify')).not.toContain('::')
    expect(groupEnd('local')).toBeUndefined()
  })
})
