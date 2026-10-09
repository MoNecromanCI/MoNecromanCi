import { parseGoWorkUses } from './go-work-uses.algorithm'

describe('parseGoWorkUses', () => {
  it('reads a use block, one directory per line', () => {
    expect(parseGoWorkUses('go 1.24\n\nuse (\n\t./apps/cli\n\t./libs/core\n)\n')).toEqual(['./apps/cli', './libs/core'])
  })

  it('reads single-line use directives', () => {
    expect(parseGoWorkUses('go 1.24\nuse ./apps/cli\nuse ./libs/core\n')).toEqual(['./apps/cli', './libs/core'])
  })

  it('reads both spellings in one file, in order, without repeats', () => {
    expect(parseGoWorkUses('use ./a\nuse (\n./b\n./a\n)\nuse ./c')).toEqual(['./a', './b', './c'])
  })

  it('ignores comments, blank lines and quotes', () => {
    expect(parseGoWorkUses('// the workspace\nuse (\n\t// the app\n\t"./apps/cli" // trailing\n\n)\n')).toEqual(['./apps/cli'])
  })

  it('reads an entry on the opening line of a block', () => {
    expect(parseGoWorkUses('use ( ./a\n./b\n)')).toEqual(['./a', './b'])
  })

  it('finds nothing in a go.work that lists no modules, or in text that is not one', () => {
    expect(parseGoWorkUses('go 1.24\n')).toEqual([])
    expect(parseGoWorkUses('replace example.com/x => ./x\n')).toEqual([])
    expect(parseGoWorkUses('')).toEqual([])
  })
})
