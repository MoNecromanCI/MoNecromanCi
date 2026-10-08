import { planDependencyMoves } from './plan-dependency-moves.algorithm'

describe('planDependencyMoves', () => {
  const root = { 'axios': '^1.6.0', 'zod': '^3.22.0', 'jest': '^30.0.0', 'left-over': '^1.0.0' }
  const usage = {
    axios: { runtime: ['packages/api', 'packages/web'], testsOnly: [] },
    zod:   { runtime: ['packages/api'], testsOnly: ['packages/web'] },
    jest:  { runtime: [], testsOnly: [] },
  }

  it('moves a package into every project that imports it, dev only where only tests do', () => {
    const plan = planDependencyMoves(root, usage, {})

    expect(plan.moves).toEqual([
      { name: 'axios', range: '^1.6.0', dir: 'packages/api', field: 'dependencies' },
      { name: 'axios', range: '^1.6.0', dir: 'packages/web', field: 'dependencies' },
      { name: 'zod', range: '^3.22.0', dir: 'packages/api', field: 'dependencies' },
      { name: 'zod', range: '^3.22.0', dir: 'packages/web', field: 'devDependencies' },
    ])
    expect(plan.removed).toEqual(['axios', 'zod'])
  })

  it('keeps at the root what no project imports, and says so', () => {
    const plan = planDependencyMoves(root, usage, {})

    expect(plan.keptAtRoot.map(entry => entry.name)).toEqual(['jest', 'left-over'])
    expect(plan.removed).not.toContain('jest')
  })

  it('never overwrites a project that already declares the package, and reports a different range', () => {
    const plan = planDependencyMoves({ axios: '^1.6.0' }, { axios: { runtime: ['packages/api', 'packages/web'], testsOnly: [] } }, {
      'packages/api': { axios: '^1.6.0' },
      'packages/web': { axios: '^0.27.0' },
    })

    expect(plan.moves).toEqual([])
    expect(plan.conflicts).toEqual([{ name: 'axios', dir: 'packages/web', projectRange: '^0.27.0', rootRange: '^1.6.0' }])
    expect(plan.removed).toEqual(['axios'])
  })
})
