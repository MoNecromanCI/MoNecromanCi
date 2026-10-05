import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrateLegacyPipeline } from './migrate-legacy-pipeline.use-case'
import { mergePipeline } from './merge-pipeline.use-case'
import { inspectPipeline, phaseEnd, phaseStart, slotMarkers } from './pipeline-markers.algorithm'

/** The shape the generators write today, GitHub-style, reduced to what the migration touches. */
const GENERATED = [
  '      - run: npm ci',
  '        name: Install dependencies',
  '',
  slotMarkers('after-install', ' '.repeat(6)),
  '',
  '      - run: npx mnci ci verify',
  '        name: Verify (sync check, then affected on a PR, every project on main)',
  '',
  phaseStart('pack', ' '.repeat(6)),
  '      - run: npx mnci ci pack',
  '        name: Pack all apps (one zip per app -> dist/drop)',
  phaseEnd('pack', ' '.repeat(6)),
  '',
  slotMarkers('before-release', ' '.repeat(6)),
  '',
  phaseStart('release', ' '.repeat(6)),
  '      - run: npx mnci ci release',
  '        name: Release — version, tag and publish',
  phaseEnd('release', ' '.repeat(6)),
  '',
  slotMarkers('after-release', ' '.repeat(6)),
  '',
].join('\n')

/** An old-style GitHub pipeline: inline guards, no markers, with the steps `extra` added by the team. */
function legacy (extra: { before?: string[], afterVerify?: string[], afterRelease?: string[] } = {}): string {
  return [
    'name: CI',
    'jobs:',
    '  ci:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '',
    '      - run: npm ci',
    '        name: Install dependencies',
    ...(extra.before ?? []),
    '',
    '      - run: node -e "guard()"',
    '        name: Verify (affected on a PR, every project on main)',
    ...(extra.afterVerify ?? []),
    '',
    '      - run: node -e "pack()"',
    '        name: Pack all apps (one zip per app -> dist/drop)',
    '',
    '      - run: node -e "release()"',
    '        name: Release — version, tag and publish (npm + Python + C#)',
    ...(extra.afterRelease ?? []),
    '',
    '  native:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo old native job',
    '',
  ].join('\n')
}

describe('migrateLegacyPipeline', () => {
  it('has nothing to move for a pipeline that is all generated steps, and says what it could not keep', () => {
    const { text, notes } = migrateLegacyPipeline(legacy(), GENERATED)

    expect(text).toBe(GENERATED)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('written before mnci kept user slots')
  })

  it('puts a step the team added before the gate into after-install, with its comment', () => {
    const existing = legacy({ before: ['', '      # warm the cache first', '      - run: ./scripts/warm-cache.sh'] })

    const { text, notes } = migrateLegacyPipeline(existing, GENERATED)

    const slot = text.slice(text.indexOf('# mnci:slot after-install'), text.indexOf('# mnci:slot-end after-install'))

    expect(slot).toContain('      # warm the cache first\n      - run: ./scripts/warm-cache.sh')
    expect(notes.some(note => note.startsWith('Kept 1 step of your own'))).toBe(true)
    expect(notes.join(' ')).toContain('./scripts/warm-cache.sh')
  })

  it('puts a step between the gate and the release into before-release, and one after the release into after-release', () => {
    const existing = legacy({
      afterVerify:  ['', '      - run: ./scripts/gate.sh', '        name: Extra gate'],
      afterRelease: ['', '      - run: ./scripts/notify.sh', '        name: Notify the team'],
    })

    const { text } = migrateLegacyPipeline(existing, GENERATED)
    const between = (slot: string): string => text.slice(text.indexOf(`# mnci:slot ${slot}`), text.indexOf(`# mnci:slot-end ${slot}`))

    expect(between('before-release')).toContain('./scripts/gate.sh')
    expect(between('after-release')).toContain('./scripts/notify.sh')
    expect(between('after-install')).not.toContain('gate.sh')
  })

  it('keeps several steps of one slot in order, one blank line apart', () => {
    const existing = legacy({ before: ['', '      - run: ./a.sh', '', '      - run: ./b.sh'] })

    const { text } = migrateLegacyPipeline(existing, GENERATED)

    expect(text).toContain('      - run: ./a.sh\n\n      - run: ./b.sh\n      # mnci:slot-end after-install')
  })

  it('does not read the old native job as steps of its own', () => {
    expect(migrateLegacyPipeline(legacy(), GENERATED).text).not.toContain('old native job')
  })

  it('keeps a phase off when the old pipeline had already dropped its step', () => {
    const existing = legacy().replace(/\n {6}- run: node -e "release\(\)"\n {8}name: Release[^\n]*\n/, '\n')

    const { text, notes } = migrateLegacyPipeline(existing, GENERATED)

    expect(inspectPipeline(text).switchedOff).toEqual(['release'])
    expect(notes.some(note => note.includes('no release step'))).toBe(true)
  })

  it('works on Azure-style steps, which are `- script:` entries with `displayName`', () => {
    const azure = [
      'steps:',
      '  - checkout: self',
      '',
      '  - script: npm ci',
      '    displayName: Install dependencies',
      '',
      '  - script: ./scripts/lint-docs.sh',
      '    displayName: Lint the docs',
      '',
      '  - script: node -e "guard()"',
      '    displayName: Verify (affected on a PR, every project on main)',
      '',
    ].join('\n')
    const generated = [
      'steps:',
      '  - script: npm ci',
      '',
      slotMarkers('after-install', '  '),
      '',
      '  - script: npx mnci ci verify',
      '',
    ].join('\n')

    const { text } = migrateLegacyPipeline(azure, generated)

    expect(text).toContain('  # mnci:slot after-install')
    expect(text).toContain('  - script: ./scripts/lint-docs.sh\n    displayName: Lint the docs')
    expect(text).not.toContain('checkout: self')
  })

  it("migrates this repository's own pre-switchover workflow: its one team step survives", () => {
    const fixture = readFileSync(join(__dirname, 'testing', 'legacy-repo-ci.fixture.yml'), 'utf8')

    const { text, notes } = migrateLegacyPipeline(fixture, GENERATED)

    expect(notes.some(note => note.startsWith('Kept 1 step of your own'))).toBe(true)
    expect(text).toContain('Verify the built package is consumable')
    expect(text.indexOf('Verify the built package is consumable')).toBeGreaterThan(text.indexOf('# mnci:slot before-release'))
    expect(text.indexOf('Verify the built package is consumable')).toBeLessThan(text.indexOf('# mnci:slot-end before-release'))
    // None of the old generated steps came along.
    expect(text).not.toContain('node -e')
  })
})

describe('mergePipeline on a pipeline from before the markers', () => {
  it('migrates it rather than regenerating it whole', () => {
    const { text } = mergePipeline(legacy({ before: ['', '      - run: ./x.sh'] }), GENERATED)

    expect(text).toContain('      - run: ./x.sh')
  })
})
