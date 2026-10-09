import { locateVersionDirectives } from './locate-version-directives.use-case'

/** A fake git: `log` is the grep output, `tags` the tag list, `released` the hashes already reachable from a tag. */
function git (log: string, tags: string[], released: string[] = []) {
  return (_command: string, arguments_: string[]) => {
    if (arguments_[0] === 'log') {
      return { status: 0, stdout: log }
    }
    if (arguments_[0] === 'tag') {
      return { status: 0, stdout: tags.join('\n') }
    }
    if (arguments_[0] === 'merge-base') {
      return { status: released.includes(arguments_[2]) ? 0 : 1, stdout: '' }
    }

    return { status: 1, stdout: '' }
  }
}

describe('locateVersionDirectives', () => {
  it('finds nothing when no commit carries a directive', () => {
    expect(locateVersionDirectives(git('', []))).toEqual([])
  })

  it('forces a project with no tag yet', () => {
    expect(locateVersionDirectives(git('h1\tversion(web)[1.0.0]: first', []))).toEqual([{ project: 'web', version: '1.0.0' }])
  })

  it('ignores a directive already reachable from the project tag', () => {
    const found = locateVersionDirectives(git('h1\tversion(web)[1.0.0]: first', ['web@1.0.0'], ['h1']))

    expect(found).toEqual([])
  })

  it('applies a directive made after the newest tag', () => {
    const found = locateVersionDirectives(git('h2\tforce(web)[3.0.0]: jump\nh1\tversion(web)[1.0.0]: first', ['web@1.0.0', 'web@2.0.0'], ['h1']))

    expect(found).toEqual([{ project: 'web', version: '3.0.0' }])
  })

  it('reads a failing git as no directives', () => {
    expect(locateVersionDirectives(() => ({ status: 128, stdout: '' }))).toEqual([])
  })
})
