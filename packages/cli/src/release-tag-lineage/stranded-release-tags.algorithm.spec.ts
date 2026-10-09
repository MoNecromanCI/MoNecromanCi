import { findStrandedReleaseTags, tagsBehindRegistry } from './stranded-release-tags.algorithm'

describe('findStrandedReleaseTags', () => {
  it('finds a scoped project whose only tags carry its unscoped name, and names the newest', () => {
    expect(findStrandedReleaseTags(['@auto/ms.teams'], ['ms.teams@1.12.9', 'ms.teams@1.12.11', 'ms.teams@1.12.10'])).toEqual([
      { project: '@auto/ms.teams', oldTag: 'ms.teams@1.12.11', newTag: '@auto/ms.teams@1.12.11' },
    ])
  })

  it('still finds it after a release restarted it at a lower version under the new name', () => {
    expect(findStrandedReleaseTags(['@auto/mysql'], ['mysql@1.12.11', '@auto/mysql@0.0.5'])).toEqual([
      { project: '@auto/mysql', oldTag: 'mysql@1.12.11', newTag: '@auto/mysql@1.12.11' },
    ])
  })

  it('leaves a project that already has a tag under its own name', () => {
    expect(findStrandedReleaseTags(['@auto/jira'], ['jira@1.0.0', '@auto/jira@1.1.0'])).toEqual([])
  })

  it('leaves a project that never had a release, and an unscoped one', () => {
    expect(findStrandedReleaseTags(['@auto/new', 'plain'], ['other@1.0.0'])).toEqual([])
  })

  it('ignores tags that are not a plain version', () => {
    expect(findStrandedReleaseTags(['@auto/x'], ['x@working', 'x@1.0.0-beta.1'])).toEqual([])
  })
})

describe('tagsBehindRegistry', () => {
  const stranded = [
    { project: '@auto/ms.teams', oldTag: 'ms.teams@1.12.11', newTag: '@auto/ms.teams@1.12.11' },
    { project: '@auto/mysql', oldTag: 'mysql@1.12.11', newTag: '@auto/mysql@1.12.11' },
    { project: '@auto/jira', oldTag: 'jira@1.0.0', newTag: '@auto/jira@1.0.0' },
  ]

  it('reports only a project whose published version is strictly newer than its tag', () => {
    const published = new Map([['@auto/ms.teams', '1.12.12'], ['@auto/mysql', '1.12.11']])

    expect(tagsBehindRegistry(stranded, published)).toEqual([
      { project: '@auto/ms.teams', tagged: '1.12.11', published: '1.12.12' },
    ])
  })

  it('ignores a project the registry does not know and a version that is not plain', () => {
    expect(tagsBehindRegistry(stranded, new Map([['@auto/jira', '2.0.0-beta.1']]))).toEqual([])
  })
})
