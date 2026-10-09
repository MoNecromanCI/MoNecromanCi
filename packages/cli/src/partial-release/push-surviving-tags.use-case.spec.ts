import { pushSurvivingTags, type TagPushProcesses } from './push-surviving-tags.use-case'

const FAILED = 'Failed tasks:\n- @auto/mysql:nx-release-publish\n'

function setup (tagList = '@auto/a@1.0.1\n@auto/mysql@0.0.6\n', pushStatus = 0): { processes: TagPushProcesses, ran: string[] } {
  const ran: string[] = []

  return {
    ran,
    processes: {
      run: (command, arguments_) => {
        ran.push([command, ...arguments_].join(' '))

        return pushStatus
      },
      capture: () => ({ status: 0, stdout: tagList }),
    },
  }
}

describe('pushSurvivingTags', () => {
  it('pushes the tags of the packages that published and holds back the failed one', () => {
    const { processes, ran } = setup()
    const logged: string[] = []

    expect(pushSurvivingTags(FAILED, processes, message => { logged.push(message) })).toBe(1)

    expect(ran).toEqual(['git push origin refs/tags/@auto/a@1.0.1'])
    expect(logged.join('\n')).toContain('Failed to publish 1 project(s): @auto/mysql.')
    expect(logged.join('\n')).toContain('Held back 1 tag(s) - @auto/mysql@0.0.6')
  })

  it('does nothing when no publish task failed', () => {
    const { processes, ran } = setup()

    expect(pushSurvivingTags('NX something else failed', processes, () => undefined)).toBe(0)
    expect(ran).toEqual([])
  })

  it('says what to do by hand when the push itself fails', () => {
    const { processes } = setup(undefined, 1)
    const logged: string[] = []

    expect(pushSurvivingTags(FAILED, processes, message => { logged.push(message) })).toBe(0)
    expect(logged.join('\n')).toContain('push them by hand')
  })
})
