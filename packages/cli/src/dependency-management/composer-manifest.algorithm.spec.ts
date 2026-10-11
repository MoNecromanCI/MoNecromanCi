import { addPathRepository, caretConstraint, composerIdentity, removePathRepository } from './composer-manifest.algorithm'

const MANIFEST = `${JSON.stringify({ name: 'acme/hello', type: 'project', require: { php: '>=8.3' } }, undefined, 4)}\n`

describe('composerIdentity', () => {
  it('reads the package name and the version a library keeps under extra.mnci', () => {
    const text = JSON.stringify({ name: 'acme/kit', extra: { mnci: { version: '0.1.0' } } })

    expect(composerIdentity(text)).toEqual({ name: 'acme/kit', version: '0.1.0' })
  })

  it('has no version for an app, and is undefined for text that is not a manifest', () => {
    expect(composerIdentity(MANIFEST)).toEqual({ name: 'acme/hello' })
    expect(composerIdentity('not json')).toBeUndefined()
    expect(composerIdentity('{}')).toBeUndefined()
  })
})

describe('caretConstraint', () => {
  it('is a caret on major.minor, which for 0.x excludes the next minor', () => {
    expect(caretConstraint('0.1.0')).toBe('^0.1')
    expect(caretConstraint('2.3.4')).toBe('^2.3')
    expect(caretConstraint('dev-main')).toBe('*')
  })
})

describe('addPathRepository', () => {
  it('declares the sibling with its version, in the file indentation', () => {
    const next = addPathRepository(MANIFEST, '../../libs/kit', 'acme/kit', '0.1.0')

    expect(JSON.parse(next).repositories).toEqual([
      { type: 'path', url: '../../libs/kit', options: { symlink: true, versions: { 'acme/kit': '0.1.0' } } },
    ])
    expect(next).toContain('\n    "repositories"')
    expect(next.endsWith('\n')).toBe(true)
  })

  it('is idempotent on the directory', () => {
    const once = addPathRepository(MANIFEST, '../../libs/kit', 'acme/kit', '0.1.0')

    expect(addPathRepository(once, '../../libs/kit', 'acme/kit', '0.2.0')).toBe(once)
  })
})

describe('removePathRepository', () => {
  it('removes it, and drops the key when it empties', () => {
    const withRepository = addPathRepository(MANIFEST, '../../libs/kit', 'acme/kit', '0.1.0')

    expect(removePathRepository(withRepository, '../../libs/kit')).toBe(MANIFEST)
  })

  it('leaves a manifest with no such repository unchanged', () => {
    expect(removePathRepository(MANIFEST, '../../libs/kit')).toBe(MANIFEST)
  })
})
