import { detectCiHost, groupEnd, groupStart, isMainPush, pullRequestTarget } from './ci-environment.client'

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

describe('isMainPush', () => {
  it('is true for a GitHub push to main, and nothing else on GitHub', () => {
    const github = { GITHUB_ACTIONS: 'true' }

    expect(isMainPush({ ...github, GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main' })).toBe(true)
    expect(isMainPush({ ...github, GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'feat/x' })).toBe(false)
    expect(isMainPush({ ...github, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: 'main' })).toBe(false)
    expect(isMainPush({ ...github, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'main' })).toBe(false)
  })

  it('is true for an Azure CI build of main, and not for a pull request or another branch', () => {
    const azure = { TF_BUILD: 'True', BUILD_SOURCEBRANCHNAME: 'main' }

    expect(isMainPush({ ...azure, BUILD_REASON: 'IndividualCI' })).toBe(true)
    expect(isMainPush({ ...azure, BUILD_REASON: 'BatchedCI' })).toBe(true)
    expect(isMainPush({ ...azure, BUILD_REASON: 'PullRequest' })).toBe(false)
    expect(isMainPush({ TF_BUILD: 'True', BUILD_REASON: 'IndividualCI', BUILD_SOURCEBRANCHNAME: 'dev' })).toBe(false)
  })

  it('is never true on a developer machine', () => {
    expect(isMainPush({})).toBe(false)
    expect(isMainPush({ GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main' })).toBe(false)
  })
})
