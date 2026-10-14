import { composerRequirements, newestStableComposerVersion, replaceComposerSpec } from './composer-requirements.algorithm'

const MANIFEST = `{
    "name": "mnci/hello",
    "require": {
        "php": ">=8.4",
        "ext-json": "*",
        "monolog/monolog": "^3.5",
        "mnci/kit": "^0.1",
        "symfony/console": "^6.4 || ^7.0"
    },
    "require-dev": {
        "monolog/monolog": "^3.0"
    }
}
`

describe('composerRequirements', () => {
  it('reads require and require-dev, and leaves out the platform', () => {
    const names = composerRequirements(MANIFEST).map(entry => `${entry.section}:${entry.name}`)

    expect(names).toEqual(['dep:monolog/monolog', 'dep:mnci/kit', 'dep:symfony/console', 'devDep:monolog/monolog'])
  })

  it('marks a compound constraint and a workspace sibling as not rewritable', () => {
    const byName = Object.fromEntries(composerRequirements(MANIFEST, new Set(['mnci/kit'])).map(entry => [`${entry.section}:${entry.name}`, entry.rewritable]))

    expect(byName).toEqual({
      'dep:monolog/monolog':    true,
      'dep:mnci/kit':           false,
      'dep:symfony/console':    false,
      'devDep:monolog/monolog': true,
    })
  })

  it('reads nothing from text that is not JSON', () => {
    expect(composerRequirements('{ nope')).toEqual([])
  })
})

describe('replaceComposerSpec', () => {
  it('moves the constraint inside its own block only, keeping every other byte', () => {
    const after = replaceComposerSpec(MANIFEST, 'monolog/monolog', '^4.0', 'devDep')

    expect(after).toBe(MANIFEST.replace('"monolog/monolog": "^3.0"', '"monolog/monolog": "^4.0"'))
  })

  it('leaves the text alone when the package is not in that block', () => {
    expect(replaceComposerSpec(MANIFEST, 'mnci/kit', '^1.0', 'devDep')).toBe(MANIFEST)
  })
})

describe('newestStableComposerVersion', () => {
  it('skips branches and pre-releases and drops the v prefix', () => {
    const output = JSON.stringify({ versions: ['dev-main', 'v4.0.0-beta1', 'v3.9.0', '3.8.1'] })

    expect(newestStableComposerVersion(output)).toBe('3.9.0')
  })

  it('answers nothing for output that holds no stable version', () => {
    expect(newestStableComposerVersion('not json')).toBeUndefined()
    expect(newestStableComposerVersion(JSON.stringify({ versions: ['dev-main'] }))).toBeUndefined()
  })
})
