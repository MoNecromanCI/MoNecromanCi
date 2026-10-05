import type { DoctorReport } from '../cli-contracts'
import { doctorProblems, doctorSummary } from './doctor-findings.mapper'

const REPORT: DoctorReport = {
  findings: [
    { check: 'one ESLint config', ok: true },
    { check: 'no retired formatter', ok: false, detail: '.prettierrc is present', remedy: 'delete .prettierrc' },
    { check: 'nx sync', ok: false },
  ],
  passed: 1,
  failed: 2,
}

describe('doctorProblems', () => {
  it('lists the failed checks only, with their remedy', () => {
    expect(doctorProblems(REPORT)).toEqual([
      { message: 'no retired formatter: .prettierrc is present', remedy: 'delete .prettierrc' },
      { message: 'nx sync', remedy: undefined },
    ])
  })

  it('has none when everything passed', () => {
    expect(doctorProblems({ findings: [{ check: 'a', ok: true }], passed: 1, failed: 0 })).toEqual([])
  })
})

describe('doctorSummary', () => {
  it('counts passed and failed', () => {
    expect(doctorSummary(REPORT)).toBe('mnci doctor: 1 passed, 2 failed')
  })

  it('says so plainly when all passed', () => {
    expect(doctorSummary({ findings: [], passed: 12, failed: 0 })).toBe('mnci doctor: all 12 checks passed')
  })
})
