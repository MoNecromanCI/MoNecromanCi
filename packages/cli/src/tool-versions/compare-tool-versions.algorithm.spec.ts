import { isNewerThanPin, versionParts } from './compare-tool-versions.algorithm'

describe('versionParts', () => {
  it.each([
    ['24', [24]],
    ['1.27', [1, 27]],
    ['2.14.0', [2, 14, 0]],
    ['v2.14.0', [2, 14, 0]],
    ['go1.27.1', [1, 27, 1]],
    ['10.0.x', [10, 0]],
    ['latest', []],
    ['', []],
  ])('reads %j as %j', (version, expected) => {
    expect(versionParts(version)).toEqual(expected)
  })
})

describe('isNewerThanPin', () => {
  it('compares a major pin by major only: patches and minors of the pinned major are not findings', () => {
    expect(isNewerThanPin('24', '24.9.0')).toBe(false)
    expect(isNewerThanPin('24', '25.0.0')).toBe(true)
    expect(isNewerThanPin('24', '26.1.0')).toBe(true)
  })

  it('compares a minor pin by major and minor', () => {
    expect(isNewerThanPin('1.27', '1.27.3')).toBe(false)
    expect(isNewerThanPin('1.27', '1.28.0')).toBe(true)
    expect(isNewerThanPin('1.27', '2.0.0')).toBe(true)
    expect(isNewerThanPin('10.0.x', '10.0.4')).toBe(false)
    expect(isNewerThanPin('10.0.x', '11.0.0')).toBe(true)
  })

  it('compares a full pin as a whole', () => {
    expect(isNewerThanPin('2.14.0', '2.14.0')).toBe(false)
    expect(isNewerThanPin('2.14.0', '2.14.1')).toBe(true)
    expect(isNewerThanPin('2.14.0', '2.15.0')).toBe(true)
    expect(isNewerThanPin('2.14.0', '1.99.9')).toBe(false)
  })

  it('compares numbers, not text', () => {
    expect(isNewerThanPin('3.9.0', '3.10.0')).toBe(true)
    expect(isNewerThanPin('3.10.0', '3.9.0')).toBe(false)
  })

  it('is false for anything it cannot read, and for a release less precise than the pin', () => {
    expect(isNewerThanPin('latest', '5.0.0')).toBe(false)
    expect(isNewerThanPin('2.14.0', 'unknown')).toBe(false)
    expect(isNewerThanPin('2.14.0', '3')).toBe(false)
  })
})
