import type { CliLocation } from '../cli-access'
import { planCliUpdate } from './plan-cli-update.algorithm'

/** A location of a given source. */
function at (source: CliLocation['source'], command = 'mnci'): CliLocation {
  return { command, prefix: [], source }
}

describe('planCliUpdate', () => {
  it("updates a workspace's own install as a dev dependency of that workspace", () => {
    expect(planCliUpdate(at('workspace'), '/ws').run).toEqual({ command: 'npm', arguments_: ['install', '--save-dev', '@mnci/cli@latest'], cwd: '/ws' })
  })

  it('updates a global install globally', () => {
    expect(planCliUpdate(at('path'), '/ws').run?.arguments_).toEqual(['install', '--global', '@mnci/cli@latest'])
  })

  it('installs it as a dev dependency of the workspace when npx is the fallback', () => {
    const plan = planCliUpdate(at('npx'), '/ws')

    expect(plan.run).toEqual({ command: 'npm', arguments_: ['install', '--save-dev', '@mnci/cli@latest'], cwd: '/ws' })
  })

  it('only refreshes what npx runs when there is no workspace to write a manifest in', () => {
    const plan = planCliUpdate(at('npx'), undefined)

    expect(plan.run?.arguments_).toEqual(['--yes', '@mnci/cli@latest', '--version'])
  })

  it('leaves a hand-set path to the user, naming it', () => {
    const plan = planCliUpdate(at('setting', 'C:/tools/mnci.cmd'), '/ws')

    expect(plan.run).toBeUndefined()
    expect(plan.reason).toContain('C:/tools/mnci.cmd')
  })
})
