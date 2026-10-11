jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { removePipDependency } from './remove-pip-dependency.algorithm'

const SINGLE_LINE = [
  '[project]',
  'name = "svc"',
  'dependencies = ["requests>=2.31", "Flask_Cors[extra]==4.0", "pydantic"]',
  '',
  '[project.optional-dependencies]',
  'dev = ["requests-mock"]',
  '',
].join('\n')

const MULTI_LINE = [
  '[project]',
  'name = "svc"',
  'dependencies = [',
  '    "requests>=2.31",',
  '    "pydantic",',
  ']',
  '',
].join('\n')

describe('removePipDependency', () => {
  it('removes a requirement from a one-line array and keeps the others in order', () => {
    expect(removePipDependency(SINGLE_LINE, 'requests')).toContain('dependencies = ["Flask_Cors[extra]==4.0", "pydantic"]')
  })

  it('matches by distribution name, so case and separators do not matter', () => {
    expect(removePipDependency(SINGLE_LINE, 'flask-cors')).toContain('dependencies = ["requests>=2.31", "pydantic"]')
  })

  it('removes a line of a multi-line array and leaves the brackets', () => {
    expect(removePipDependency(MULTI_LINE, 'requests')).toBe([
      '[project]',
      'name = "svc"',
      'dependencies = [',
      '    "pydantic",',
      ']',
      '',
    ].join('\n'))
  })

  it('leaves optional dependencies alone, even when they share a prefix', () => {
    expect(removePipDependency(SINGLE_LINE, 'requests')).toContain('dev = ["requests-mock"]')
  })

  it('returns the text unchanged when the package is not declared', () => {
    expect(removePipDependency(SINGLE_LINE, 'numpy')).toBe(SINGLE_LINE)
    expect(removePipDependency(MULTI_LINE, 'numpy')).toBe(MULTI_LINE)
  })

  it('keeps CRLF line endings', () => {
    const crlf = MULTI_LINE.replaceAll('\n', '\r\n')

    expect(removePipDependency(crlf, 'pydantic')).toBe(crlf.replace('    "pydantic",\r\n', ''))
  })
})
