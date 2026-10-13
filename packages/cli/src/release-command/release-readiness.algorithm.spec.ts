import { assessRelease, type ReleaseFindings } from './release-readiness.algorithm'

const CLEAN: ReleaseFindings = { stranded: [], behind: [], untagged: [], branch: 'main', tagsFetched: true }

describe('assessRelease', () => {
  it('has nothing to say about a clean workspace on main', () => {
    expect(assessRelease(CLEAN, false)).toEqual({ blockers: [], warnings: [] })
  })

  it('blocks on tags stranded under an old name, naming the command that fixes it', () => {
    const result = assessRelease({ ...CLEAN, stranded: [{ project: '@auto/snyk', oldTag: 'snyk@1.12.4', newTag: '@auto/snyk@1.12.4' }] }, true)

    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0]).toContain('mnci adopt --tags')
    expect(result.blockers[0]).toContain('@auto/snyk@1.12.4')
  })

  it('blocks on a published package with no tag, and says to fetch tags before anything else', () => {
    const result = assessRelease({ ...CLEAN, untagged: [{ project: '@auto/azure.cosmos', published: '1.4.0' }] }, true)

    expect(result.blockers[0]).toContain('@auto/azure.cosmos is published at 1.4.0')
    expect(result.blockers[0]).toContain('git fetch --tags')
    expect(result.blockers[0]).toContain('git tag @auto/azure.cosmos@1.4.0')
  })

  it('blocks on a tag behind the registry', () => {
    const result = assessRelease({ ...CLEAN, behind: [{ project: '@auto/mysql', tagged: '1.12.11', published: '1.12.13' }] }, false)

    expect(result.blockers[0]).toMatch(/tagged 1\.12\.11 but the registry already has 1\.12\.13/)
  })

  it('warns, never blocks, when the tags could not be fetched', () => {
    const result = assessRelease({ ...CLEAN, tagsFetched: false }, false)

    expect(result.blockers).toEqual([])
    expect(result.warnings[0]).toContain('git fetch --tags')
  })

  it('lets a preview run from a branch with a warning but refuses a real release there', () => {
    const preview = assessRelease({ ...CLEAN, branch: 'feat/x' }, true)
    const real = assessRelease({ ...CLEAN, branch: 'feat/x' }, false)

    expect(preview).toMatchObject({ blockers: [], warnings: [expect.stringContaining('feat/x')] })
    expect(real.blockers[0]).toContain('feat/x')
  })

  it('does not judge a detached head, whose branch is unknown', () => {
    expect(assessRelease({ ...CLEAN, branch: undefined }, false)).toEqual({ blockers: [], warnings: [] })
  })
})
