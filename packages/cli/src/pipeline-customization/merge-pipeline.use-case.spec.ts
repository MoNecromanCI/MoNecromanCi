import { mergePipeline } from './merge-pipeline.use-case'
import { inspectPipeline, phaseEnd, phaseStart, slotMarkers } from './pipeline-markers.algorithm'

/** A small pipeline in the shape the generators write, with one step in each choosable phase. */
function pipeline (indent = ' '.repeat(6)): string {
  return [
    `${indent}- run: npm ci`,
    '',
    slotMarkers('after-install', indent),
    '',
    `${indent}- run: npx mnci ci verify`,
    '',
    phaseStart('pack', indent),
    `${indent}# Pack every app.`,
    `${indent}- run: npx mnci ci pack`,
    `${indent}  if: main`,
    phaseEnd('pack', indent),
    '',
    slotMarkers('before-release', indent),
    '',
    phaseStart('release', indent),
    `${indent}- run: npx mnci ci release`,
    phaseEnd('release', indent),
    '',
    slotMarkers('after-release', indent),
    '',
  ].join('\n')
}

/** Puts a user step into the named slot of a pipeline. */
function withSlotStep (text: string, slot: string, step: string): string {
  const marker = new RegExp(String.raw`# mnci:slot ${slot} [^\n]*\n`)

  return text.replace(marker, line => `${line}${step}\n`)
}

describe('mergePipeline', () => {
  it('writes the generated file as it is when there is nothing to replace', () => {
    expect(mergePipeline(undefined, pipeline())).toEqual({ text: pipeline(), notes: [] })
  })

  it('is a no-op on a file nobody touched', () => {
    expect(mergePipeline(pipeline(), pipeline()).text).toBe(pipeline())
  })

  it('carries what the team put in a slot into the regenerated file', () => {
    const existing = withSlotStep(pipeline(), 'after-install', '      - run: ./scripts/bootstrap.sh')
    const generated = pipeline().replace('npx mnci ci verify', 'npx mnci ci verify --fast')

    const { text } = mergePipeline(existing, generated)

    expect(text).toContain('      - run: ./scripts/bootstrap.sh')
    expect(text).toContain('npx mnci ci verify --fast')
    expect(text.indexOf('bootstrap.sh')).toBeGreaterThan(text.indexOf('# mnci:slot after-install'))
    expect(text.indexOf('bootstrap.sh')).toBeLessThan(text.indexOf('# mnci:slot-end after-install'))
  })

  it('re-indents a slot when the new file nests its steps deeper', () => {
    const existing = withSlotStep(pipeline('  '), 'before-release', '  - script: echo hi')

    const { text } = mergePipeline(existing, pipeline(' '.repeat(6)))

    expect(text).toContain('\n      - script: echo hi\n')
  })

  it('leaves the phase on when its steps are still live', () => {
    const { text, notes } = mergePipeline(pipeline(), pipeline())

    expect(notes).toEqual([])
    expect(inspectPipeline(text).switchedOff).toEqual([])
  })

  it('keeps a phase off when the team deleted its block, commented out', () => {
    const existing = pipeline()
      .replace(/ {6}# mnci:phase release[\s\S]*?# mnci:phase-end release\n/, '')

    const { text, notes } = mergePipeline(existing, pipeline())

    expect(inspectPipeline(text).switchedOff).toEqual(['release'])
    expect(text).toContain('      # - run: npx mnci ci release')
    expect(text).toContain('# mnci: switched off.')
    expect(notes).toEqual(['The release phase is switched off in this pipeline and stays off.'])
  })

  it('keeps a phase off when its steps were commented out by hand, and is stable on the next upgrade', () => {
    const existing = pipeline().replace('      - run: npx mnci ci release', '      # - run: npx mnci ci release')

    const first = mergePipeline(existing, pipeline()).text
    const second = mergePipeline(first, pipeline()).text

    expect(inspectPipeline(first).switchedOff).toEqual(['release'])
    expect(second).toBe(first)
  })

  it('turns a phase back on once the team uncomments it', () => {
    const commented = pipeline().replace('      - run: npx mnci ci release', '      # - run: npx mnci ci release')
    const off = mergePipeline(commented, pipeline()).text
    const on = off.replace('      # - run: npx mnci ci release', '      - run: npx mnci ci release')

    const merged = mergePipeline(on, pipeline()).text

    expect(inspectPipeline(merged).switchedOff).toEqual([])
  })

  it('regenerates a file from before the markers whole, and says so', () => {
    const legacy = '      - run: npx nx affected\n'

    const { text, notes } = mergePipeline(legacy, pipeline())

    expect(text).toBe(pipeline())
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('written before mnci kept user slots')
  })

  it('reads a file with Windows line endings', () => {
    const existing = withSlotStep(pipeline(), 'after-release', '      - run: ./notify.sh').replaceAll('\n', '\r\n')

    expect(mergePipeline(existing, pipeline()).text).toContain('      - run: ./notify.sh')
  })
})

describe('inspectPipeline', () => {
  it('sees an active verify call, and ignores a commented one', () => {
    expect(inspectPipeline(pipeline()).verifyActive).toBe(true)
    expect(inspectPipeline(pipeline().replace('- run: npx mnci ci verify', '# - run: npx mnci ci verify')).verifyActive).toBe(false)
  })

  it('also accepts the CLI called by path, as this repo does', () => {
    expect(inspectPipeline('- run: node packages/cli/dist/cli.js ci verify\n').verifyActive).toBe(true)
  })
})
