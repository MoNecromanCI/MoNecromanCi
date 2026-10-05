import { describePhaseOutcome, formatDuration } from './phase-timing.algorithm'

describe('formatDuration', () => {
  it('shows seconds with a decimal under a minute', () => {
    expect(formatDuration(0)).toBe('0.0s')
    expect(formatDuration(3140)).toBe('3.1s')
    expect(formatDuration(59_940)).toBe('59.9s')
  })

  it('shows minutes and zero-padded seconds from a minute up', () => {
    expect(formatDuration(64_000)).toBe('1m 04s')
    expect(formatDuration(783_000)).toBe('13m 03s')
  })

  it('treats a negative interval, which a clock step can produce, as zero', () => {
    expect(formatDuration(-5)).toBe('0.0s')
  })
})

describe('describePhaseOutcome', () => {
  it('gives a pass a log line and a summary line, and no annotation', () => {
    expect(describePhaseOutcome('github', 'verify', 0, 64_000)).toEqual({
      log:     'mnci ci verify: passed in 1m 04s',
      summary: '- ✅ **verify** passed in 1m 04s',
    })
  })

  it('annotates a failure with the GitHub error command, naming the phase', () => {
    const outcome = describePhaseOutcome('github', 'release', 2, 3100)

    expect(outcome.annotation).toBe('::error title=mnci ci release::The release phase failed with exit status 2 after 3.1s')
    expect(outcome.log).toBe('mnci ci release: failed (exit 2) in 3.1s')
    expect(outcome.summary).toContain('❌')
  })

  it('annotates a failure with the Azure logging command', () => {
    expect(describePhaseOutcome('azure', 'pack', 1, 1000).annotation)
      .toBe('##vso[task.logissue type=error;]The pack phase failed with exit status 1 after 1.0s')
  })

  it('adds no annotation off CI, where the exit status is the signal', () => {
    expect(describePhaseOutcome('local', 'verify', 1, 1000).annotation).toBeUndefined()
  })
})
