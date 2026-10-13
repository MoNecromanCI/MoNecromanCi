import { chunkDirectories, isEslintLinted } from './eslint-project.algorithm'

describe('isEslintLinted', () => {
  it('accepts an npm project with no explicit lint target, which is the inferred eslint', () => {
    expect(isEslintLinted({ hasPackageJson: true, lintTarget: undefined })).toBe(true)
  })

  it('accepts an explicit eslint target, however it is spelled', () => {
    expect(isEslintLinted({ hasPackageJson: true, lintTarget: '{"executor":"@nx/eslint:lint"}' })).toBe(true)
    expect(isEslintLinted({ hasPackageJson: true, lintTarget: '{"options":{"command":"eslint . --cache"}}' })).toBe(true)
  })

  it('leaves an npm project whose lint is another tool to Nx', () => {
    expect(isEslintLinted({ hasPackageJson: true, lintTarget: '{"options":{"command":"astro check"}}' })).toBe(false)
  })

  it('leaves a project with no package.json (Go, Python, Rust, ...) to Nx', () => {
    expect(isEslintLinted({ hasPackageJson: false, lintTarget: undefined })).toBe(false)
  })
})

describe('chunkDirectories', () => {
  it('keeps everything in one chunk when it fits', () => {
    expect(chunkDirectories(['apps/a', 'libs/b'], 100)).toEqual([['apps/a', 'libs/b']])
  })

  it('starts a new chunk when the next folder would pass the limit, keeping order', () => {
    expect(chunkDirectories(['aaaa', 'bbbb', 'cccc'], 10)).toEqual([['aaaa', 'bbbb'], ['cccc']])
  })

  it('puts a folder longer than the limit in a chunk of its own rather than dropping it', () => {
    expect(chunkDirectories(['x'.repeat(20), 'y'], 10)).toEqual([['x'.repeat(20)], ['y']])
  })

  it('is empty for no folders', () => {
    expect(chunkDirectories([], 10)).toEqual([])
  })
})
