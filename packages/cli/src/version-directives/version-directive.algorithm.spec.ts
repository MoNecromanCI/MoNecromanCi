import { parseVersionDirective, pickVersionDirectives, VERSION_DIRECTIVE_TYPES } from './version-directive.algorithm'

describe('parseVersionDirective', () => {
  it.each(VERSION_DIRECTIVE_TYPES)('reads the %s alias', (type) => {
    expect(parseVersionDirective(`${type}(@mnci/cli)[1.2.3]: ship it`)).toEqual({ project: '@mnci/cli', version: '1.2.3' })
  })

  it('reads a prerelease version', () => {
    expect(parseVersionDirective('version(web)[2.0.0-rc.1]: try it')).toEqual({ project: 'web', version: '2.0.0-rc.1' })
  })

  it.each([
    'feat(cli): add a thing',
    'version(web): no version',
    'version(web)[1.2]: not a full version',
    'version(web)[1.2.3]:',
    'versions(web)[1.2.3]: unknown alias',
    'chore: version(web)[1.2.3]: not at the start',
  ])('ignores %p', (subject) => {
    expect(parseVersionDirective(subject)).toBeUndefined()
  })
})

describe('pickVersionDirectives', () => {
  it('keeps the newest directive of a project', () => {
    const picked = pickVersionDirectives([{ project: 'a', version: '3.0.0' }, { project: 'a', version: '2.0.0' }], new Map())

    expect(picked).toEqual([{ project: 'a', version: '3.0.0' }])
  })

  it('drops a version at or below the newest tag', () => {
    const tagged = new Map([['a', '2.0.0'], ['b', '1.0.0']])
    const picked = pickVersionDirectives([{ project: 'a', version: '2.0.0' }, { project: 'b', version: '0.9.0' }], tagged)

    expect(picked).toEqual([])
  })

  it('falls through to an older directive that is still above the tag', () => {
    const picked = pickVersionDirectives([{ project: 'a', version: '1.0.0' }, { project: 'a', version: '4.0.0' }], new Map([['a', '2.0.0']]))

    expect(picked).toEqual([{ project: 'a', version: '4.0.0' }])
  })
})
