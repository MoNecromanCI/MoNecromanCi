import { failedPublishProjects, survivingTags } from './failed-publish.algorithm'

describe('failedPublishProjects', () => {
  it('reads the projects nx lists under "Failed tasks", through colour codes', () => {
    const output = [
      '\u{1B}[7m\u{1B}[1m\u{1B}[31m NX \u{1B}[39m  Running target nx-release-publish for 22 projects failed',
      '\u{1B}[2mFailed tasks:\u{1B}[22m',
      '\u{1B}[2m-\u{1B}[22m @auto/ms.teams:nx-release-publish',
      '\u{1B}[2m-\u{1B}[22m @auto/mysql:nx-release-publish',
    ].join('\r\n')

    expect(failedPublishProjects(output)).toEqual(['@auto/ms.teams', '@auto/mysql'])
  })

  it('finds nothing when the failure was not a publish task', () => {
    expect(failedPublishProjects('NX Cannot version\n- some other thing')).toEqual([])
  })
})

describe('survivingTags', () => {
  it('holds back only the tags of the failed projects', () => {
    const tags = ['@auto/a@1.0.1', '@auto/ms.teams@0.0.6', '@auto/mysql@0.0.6']

    expect(survivingTags(tags, ['@auto/ms.teams', '@auto/mysql'])).toEqual({
      push: ['@auto/a@1.0.1'],
      held: ['@auto/ms.teams@0.0.6', '@auto/mysql@0.0.6'],
    })
  })

  it('does not match a project by a shared prefix', () => {
    expect(survivingTags(['@auto/ms.teams-extra@1.0.0'], ['@auto/ms.teams']).push).toEqual(['@auto/ms.teams-extra@1.0.0'])
  })

  it('pushes nothing when a tag does not name its project, since it cannot be attributed', () => {
    expect(survivingTags(['v1.2.3', '@auto/a@1.0.1'], ['@auto/a']).push).toEqual([])
  })

  it('pushes nothing when no failure is known', () => {
    expect(survivingTags(['@auto/a@1.0.1'], []).push).toEqual([])
  })
})
