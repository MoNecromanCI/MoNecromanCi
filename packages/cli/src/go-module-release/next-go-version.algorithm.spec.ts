import { bumpVersion, latestVersion, nextTag, parseVersionTag, releaseBump } from './next-go-version.algorithm'

const PREFIX = 'packages/tty/'

describe('parseVersionTag', () => {
  it('reads a plain version of this module', () => {
    expect(parseVersionTag('packages/tty/v1.2.3', PREFIX)).toEqual([1, 2, 3])
  })

  it.each(['packages/other/v1.2.3', 'packages/tty/v1.2', 'packages/tty/v1.2.3-rc.1', 'packages/tty/1.2.3', 'v1.2.3'])(
    'does not read %s as a version of this module',
    tag => {
      expect(parseVersionTag(tag, PREFIX)).toBeUndefined()
    },
  )
})

describe('latestVersion', () => {
  it('is the highest, compared as numbers, not text', () => {
    expect(latestVersion(['packages/tty/v0.9.0', 'packages/tty/v0.10.0', 'packages/tty/v0.2.7'], PREFIX)).toEqual([0, 10, 0])
  })

  it('ignores other modules and non-version tags, and is undefined with none', () => {
    expect(latestVersion(['packages/other/v5.0.0', 'release-1'], PREFIX)).toBeUndefined()
    expect(latestVersion([], PREFIX)).toBeUndefined()
  })
})

describe('releaseBump', () => {
  it('releases nothing for commits that are not a feature, fix, performance change or breaking change', () => {
    const commits = ['docs: x', 'chore: x', 'test: x', 'ci: x', 'refactor: x', 'build: x', 'style: x', 'not conventional'].map(subject => ({ subject }))

    expect(releaseBump(commits, 1)).toBeUndefined()
    expect(releaseBump([], 1)).toBeUndefined()
  })

  it('from 1.0 a breaking change is major, a feat minor, and a fix or perf patch, the highest winning', () => {
    expect(releaseBump([{ subject: 'fix(go): x' }, { subject: 'feat: y' }], 1)).toBe('minor')
    expect(releaseBump([{ subject: 'perf: x' }], 1)).toBe('patch')
    expect(releaseBump([{ subject: 'feat!: x' }, { subject: 'fix: y' }], 1)).toBe('major')
    expect(releaseBump([{ subject: 'fix: x', body: 'BREAKING CHANGE: the API moved' }], 2)).toBe('major')
  })

  it('before 1.0 a feat and a fix are patches and a breaking change is a minor', () => {
    expect(releaseBump([{ subject: 'feat: x' }], 0)).toBe('patch')
    expect(releaseBump([{ subject: 'fix: x' }], 0)).toBe('patch')
    expect(releaseBump([{ subject: 'feat(tty)!: x' }], 0)).toBe('minor')
    expect(releaseBump([{ subject: 'chore: x', body: 'BREAKING-CHANGE: y' }], 0)).toBe('minor')
  })
})

describe('bumpVersion', () => {
  it('resets what comes after the part it moves', () => {
    expect(bumpVersion([1, 4, 7], 'major')).toEqual([2, 0, 0])
    expect(bumpVersion([1, 4, 7], 'minor')).toEqual([1, 5, 0])
    expect(bumpVersion([1, 4, 7], 'patch')).toEqual([1, 4, 8])
  })
})

describe('nextTag', () => {
  it('tags v0.0.1 on the first commit that touched a module with no tag, whatever it says', () => {
    expect(nextTag({ tags: [], commits: [{ subject: 'docs: x' }], prefix: PREFIX })).toEqual({ tag: 'packages/tty/v0.0.1', bump: 'first' })
  })

  it('tags nothing for a module with no tag and no commits', () => {
    expect(nextTag({ tags: [], commits: [], prefix: PREFIX })).toBeUndefined()
  })

  it('bumps from the latest tag of this module only', () => {
    const tags = ['packages/tty/v0.3.1', 'packages/other/v9.0.0']

    expect(nextTag({ tags, commits: [{ subject: 'feat: x' }], prefix: PREFIX })).toEqual({ tag: 'packages/tty/v0.3.2', bump: 'patch' })
    expect(nextTag({ tags, commits: [{ subject: 'fix!: x' }], prefix: PREFIX })).toEqual({ tag: 'packages/tty/v0.4.0', bump: 'minor' })
  })

  it('tags nothing when the commits since the latest tag release nothing', () => {
    expect(nextTag({ tags: ['packages/tty/v1.0.0'], commits: [{ subject: 'docs: x' }], prefix: PREFIX })).toBeUndefined()
  })
})
