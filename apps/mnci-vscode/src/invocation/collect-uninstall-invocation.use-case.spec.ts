import type { ProjectSummary } from '../cli-contracts'
import { collectUninstallInvocation } from './collect-uninstall-invocation.use-case'
import { scriptedPrompter } from './testing/scripted-prompter.mock'

const PROJECTS: ProjectSummary[] = [
  { name: 'web', dir: 'apps/web', ecosystem: 'npm', targets: [] },
  { name: 'api', dir: 'apps/api', ecosystem: 'go', targets: [] },
]

describe('collectUninstallInvocation', () => {
  it('removes the packages from the chosen projects, with the option after the packages', async () => {
    const { prompter } = scriptedPrompter([['web', 'api'], 'zod  dayjs'])

    const result = await collectUninstallInvocation(PROJECTS, prompter)

    expect(result?.arguments).toEqual(['uninstall', 'zod', 'dayjs', '--workspace', 'web', '--workspace', 'api'])
  })

  it('offers the workspace\'s own projects, by name with their directory', async () => {
    const { prompter, entriesSeen } = scriptedPrompter([[], 'zod'])

    await collectUninstallInvocation(PROJECTS, prompter)

    expect(entriesSeen[0]).toEqual([
      { label: 'web', value: 'web', description: 'apps/web', detail: 'npm' },
      { label: 'api', value: 'api', description: 'apps/api', detail: 'go' },
    ])
  })

  it('does nothing when no project is chosen: a package with no target is refused by the CLI', async () => {
    expect(await collectUninstallInvocation(PROJECTS, scriptedPrompter([[]]).prompter)).toBeUndefined()
  })

  it('says so when the workspace has no project', async () => {
    await expect(collectUninstallInvocation([], scriptedPrompter([]).prompter)).rejects.toThrow(/no projects/)
  })

  it.each([
    ['the projects', [undefined]],
    ['the packages', [['web'], undefined]],
  ])('does nothing when the user cancels %s', async (_step, answers) => {
    expect(await collectUninstallInvocation(PROJECTS, scriptedPrompter(answers).prompter)).toBeUndefined()
  })
})
