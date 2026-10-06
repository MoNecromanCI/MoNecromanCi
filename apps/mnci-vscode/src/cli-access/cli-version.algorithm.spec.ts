import { isCliVersionSupported, MIN_CLI_VERSION, parseCliVersion } from './cli-version.algorithm'

describe('parseCliVersion', () => {
  it('reads the number mnci --version prints', () => {
    expect(parseCliVersion('4.30.0\n')).toEqual([4, 30, 0])
  })

  it('reads the first version in a longer output', () => {
    expect(parseCliVersion('npm warn something\nmnci 4.32.1 (node 24.12.0)')).toEqual([4, 32, 1])
  })

  it('has nothing to read in output without a version', () => {
    expect(parseCliVersion('')).toBeUndefined()
    expect(parseCliVersion('command not found')).toBeUndefined()
  })
})

describe('isCliVersionSupported', () => {
  it('names 4.32.0, the first release with the JSON commands, as the minimum', () => {
    expect(MIN_CLI_VERSION).toBe('4.32.0')
  })

  it.each([
    ['4.32.0', true],
    ['4.32.1', true],
    ['4.40.4', true],
    ['5.0.0', true],
    ['4.31.9', false],
    ['4.30.0', false],
    ['3.99.99', false],
    ['not a version', false],
    ['', false],
  ])('%s is %s', (version, supported) => {
    expect(isCliVersionSupported(version)).toBe(supported)
  })

  it('compares against a minimum that is given', () => {
    expect(isCliVersionSupported('1.2.3', '1.2.4')).toBe(false)
    expect(isCliVersionSupported('1.2.4', '1.2.4')).toBe(true)
  })

  it('treats an unreadable minimum as unsatisfiable', () => {
    expect(isCliVersionSupported('4.40.0', 'x')).toBe(false)
  })
})
