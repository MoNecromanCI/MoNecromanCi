import type { Outdated } from './outdated.contract'
import { toUpdateReport } from './update-report.mapper'

function outdated (name: string, kind: Outdated['kind'], overrides: Partial<Outdated> = {}): Outdated {
  return {
    name,
    ecosystem: 'npm',
    current:   '1.0.0',
    latest:    '1.0.1',
    kind,
    sites:     [{ name, ecosystem: 'npm', project: 'packages/a', manifestPath: '/w/packages/a/package.json', section: 'dep', spec: '^1.0.0', rewritable: true }],
    ...overrides,
  }
}

describe('toUpdateReport', () => {
  it('orders by section, then by name, as the terminal report does', () => {
    const report = toUpdateReport([outdated('zod', 'minor'), outdated('ms', 'patch'), outdated('chalk', 'major'), outdated('axios', 'minor')])

    expect(report.updates.map(entry => entry.name)).toEqual(['ms', 'axios', 'zod', 'chalk'])
  })

  it('carries the versions, the registry page and the distinct projects and sections', () => {
    const entry = outdated('@nx/js', 'minor', {
      current: '23.1.1',
      latest:  '23.3.0',
      sites:   [
        { name: '@nx/js', ecosystem: 'npm', project: '(root)', manifestPath: '/w/package.json', section: 'devDep', spec: '23.1.1', rewritable: true },
        { name: '@nx/js', ecosystem: 'npm', project: '(root)', manifestPath: '/w/package.json', section: 'devDep', spec: '23.1.1', rewritable: true },
        { name: '@nx/js', ecosystem: 'npm', project: 'packages/b', manifestPath: '/w/packages/b/package.json', section: 'dep', spec: '23.1.1', rewritable: true },
      ],
    })

    expect(toUpdateReport([entry]).updates[0]).toEqual({
      name:      '@nx/js',
      ecosystem: 'npm',
      kind:      'minor',
      current:   '23.1.1',
      latest:    '23.3.0',
      link:      'https://www.npmjs.com/package/@nx/js/v/23.3.0',
      projects:  ['(root)', 'packages/b'],
      sections:  ['dep', 'devDep'],
    })
  })

  it('leaves out the link for an ecosystem with no registry page', () => {
    expect(toUpdateReport([outdated('fmt', 'minor', { ecosystem: 'cmake' })]).updates[0]).not.toHaveProperty('link')
  })
})
