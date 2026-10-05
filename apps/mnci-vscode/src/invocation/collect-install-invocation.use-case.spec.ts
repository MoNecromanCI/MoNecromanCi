import type { ProjectSummary } from '../cli-contracts'
import { collectInstallInvocation } from './collect-install-invocation.use-case'
import { scriptedPrompter } from './testing/scripted-prompter.mock'

const PROJECTS: ProjectSummary[] = [
  { name: 'web', dir: 'apps/web', ecosystem: 'npm', targets: [] },
  { name: 'api', dir: 'apps/api', ecosystem: 'go', targets: [] },
]

describe('collectInstallInvocation', () => {
  it('restores the whole workspace when asked to, with no further questions', async () => {
    const { prompter, asked } = scriptedPrompter(['restore'])

    expect(await collectInstallInvocation(PROJECTS, prompter)).toEqual({ arguments: ['install'] })
    expect(asked).toHaveLength(1)
  })

  it('adds packages to the chosen projects, with the option after the packages', async () => {
    const { prompter } = scriptedPrompter(['add', 'zod  dayjs', ['web', 'api'], 'dependency'])

    const result = await collectInstallInvocation(PROJECTS, prompter)

    expect(result?.arguments).toEqual(['install', 'zod', 'dayjs', '--workspace', 'web', '--workspace', 'api'])
  })

  it('marks a development dependency', async () => {
    const { prompter } = scriptedPrompter(['add', 'vitest', ['web'], 'dev'])

    const result = await collectInstallInvocation(PROJECTS, prompter)

    expect(result?.arguments).toEqual(['install', 'vitest', '--workspace', 'web', '--save-dev'])
  })

  it('offers the workspace\'s own projects, by name with their directory', async () => {
    const { prompter, entriesSeen } = scriptedPrompter(['add', 'zod', [], 'dependency'])

    await collectInstallInvocation(PROJECTS, prompter)

    expect(entriesSeen[1]).toEqual([
      { label: 'web', value: 'web', description: 'apps/web', detail: 'npm' },
      { label: 'api', value: 'api', description: 'apps/api', detail: 'go' },
    ])
  })

  it('does nothing when no project is chosen: a package with no target is refused by the CLI', async () => {
    expect(await collectInstallInvocation(PROJECTS, scriptedPrompter(['add', 'zod', []]).prompter)).toBeUndefined()
  })

  it('says so when the workspace has no project to add a package to', async () => {
    await expect(collectInstallInvocation([], scriptedPrompter(['add']).prompter)).rejects.toThrow(/no projects/)
  })

  it.each([
    ['the mode', [undefined]],
    ['the packages', ['add', undefined]],
    ['the projects', ['add', 'zod', undefined]],
    ['the kind of dependency', ['add', 'zod', ['web'], undefined]],
  ])('does nothing when the user cancels %s', async (_step, answers) => {
    expect(await collectInstallInvocation(PROJECTS, scriptedPrompter(answers).prompter)).toBeUndefined()
  })
})
