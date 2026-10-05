import type { DoctorReport } from '../cli-contracts'
import type { CliSession } from '../cli-session'
import { runDoctorCheck, type DoctorSurface } from './run-doctor-check.use-case'

/** A session whose doctor returns a fixed report. */
function session (report: DoctorReport | Error): CliSession {
  return { doctor: () => (report instanceof Error ? Promise.reject(report) : Promise.resolve(report)) } as unknown as CliSession
}

/** A surface that records what it was shown. */
function surface (): DoctorSurface & { showProblems: jest.Mock, tell: jest.Mock } {
  return { showProblems: jest.fn(), tell: jest.fn() }
}

describe('runDoctorCheck', () => {
  it('shows each failed check as a problem and warns with the count', async () => {
    const ui = surface()

    await runDoctorCheck(session({ findings: [{ check: 'a', ok: false, remedy: 'fix a' }], passed: 3, failed: 1 }), ui)

    expect(ui.showProblems).toHaveBeenCalledWith([{ message: 'a', remedy: 'fix a' }])
    expect(ui.tell).toHaveBeenCalledWith('mnci doctor: 3 passed, 1 failed', 'warning')
  })

  it('clears the previous problems and says all is well on a clean run', async () => {
    const ui = surface()

    await runDoctorCheck(session({ findings: [], passed: 5, failed: 0 }), ui)

    expect(ui.showProblems).toHaveBeenCalledWith([])
    expect(ui.tell).toHaveBeenCalledWith('mnci doctor: all 5 checks passed', 'info')
  })

  it('lets a CLI that printed nothing readable surface as an error, leaving the old problems alone', async () => {
    const ui = surface()

    const failing = session(new Error('mnci doctor --json failed'))

    await expect(runDoctorCheck(failing, ui)).rejects.toThrow(/failed/)

    expect(ui.showProblems).not.toHaveBeenCalled()
  })
})
