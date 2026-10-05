import { nameFrom } from './command-arguments.algorithm'

describe('nameFrom', () => {
  it('takes a string as it is', () => {
    expect(nameFrom('web')).toBe('web')
  })

  it('reads the label of a tree row, which a context menu passes', () => {
    expect(nameFrom({ id: 'project:apps/web', label: 'web', contextValue: 'mnci.project' })).toBe('web')
  })

  it.each([undefined, null, 3, {}, { label: 7 }])('has no name in %j', value => {
    expect(nameFrom(value)).toBeUndefined()
  })
})
