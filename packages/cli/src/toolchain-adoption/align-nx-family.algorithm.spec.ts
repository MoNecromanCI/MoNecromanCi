import { alignNxFamily, chooseNxVersion, isNxFamily } from './align-nx-family.algorithm'

describe('isNxFamily', () => {
  it('takes nx and the @nx scope, and not other projects that start with nx', () => {
    expect([isNxFamily('nx'), isNxFamily('@nx/js'), isNxFamily('@nx-go/nx-go'), isNxFamily('nx-cloud')]).toEqual([true, true, false, false])
  })
})

describe('chooseNxVersion', () => {
  const declared = { 'nx': '23.1.1', '@nx/js': '23.1.1', '@nx/node': '^23.1.1', 'typescript': '^6.0.0' }
  const published = ['22.9.0', '23.1.1', '23.2.0', '23.3.0', '23.3.1-beta.0', '24.0.0']

  it('takes the newest stable version of the major already in use', () => {
    expect(chooseNxVersion(declared, published)).toBe('23.3.0')
  })

  it('honours an explicit request', () => {
    expect(chooseNxVersion(declared, published, '24.0.0')).toBe('24.0.0')
  })

  it('has nothing to align when Nx is not declared', () => {
    expect(chooseNxVersion({ typescript: '^6.0.0' }, published)).toBeUndefined()
  })

  it('has nothing to choose when the registry could not be read', () => {
    expect(chooseNxVersion(declared, [])).toBeUndefined()
  })
})

describe('alignNxFamily', () => {
  it('pins every family member and names what moved, leaving the rest alone', () => {
    const { dependencies, changed } = alignNxFamily({ 'nx': '23.1.1', '@nx/node': '^23.1.1', '@nx/js': '23.3.0', 'jest': '^30.0.0' }, '23.3.0')

    expect(dependencies).toEqual({ 'nx': '23.3.0', '@nx/node': '23.3.0', '@nx/js': '23.3.0', 'jest': '^30.0.0' })
    expect(changed).toEqual(['nx', '@nx/node'])
  })
})
