import type { CliSession } from '../cli-session'
import { scriptedPrompter } from '../invocation/testing/scripted-prompter.mock'
import { runTarget } from './run-target.use-case'

const PROJECTS = [
  { name: 'web', dir: 'apps/web', ecosystem: 'npm', targets: ['build', 'preview'] },
  { name: 'api', dir: 'apps/api', ecosystem: 'go', targets: [] },
]

/** A session with the fixed projects. */
function session (projects = PROJECTS): CliSession {
  return { workspaceRoot: '/ws', projects: () => Promise.resolve(projects) } as unknown as CliSession
}

describe('runTarget', () => {
  it('runs a given project and target without asking anything', async () => {
    const run = jest.fn()
    const { prompter, asked } = scriptedPrompter([])

    await runTarget({ session: session(), prompter, run }, 'web', 'build')

    expect(run).toHaveBeenCalledWith('npx', ['nx', 'run', 'web:build'], '/ws')
    expect(asked).toEqual([])
  })

  it('asks for the project and the target when neither is given', async () => {
    const run = jest.fn()

    await runTarget({ session: session(), prompter: scriptedPrompter(['api', 'test']).prompter, run })

    expect(run).toHaveBeenCalledWith('npx', ['nx', 'run', 'api:test'], '/ws')
  })

  it("offers the project's own targets first, then the usual ones, without repeating any", async () => {
    const { prompter, entriesSeen } = scriptedPrompter(['build'])

    await runTarget({ session: session(), prompter, run: jest.fn() }, 'web')

    expect((entriesSeen[0] as Array<{ value: string }>).map(entry => entry.value)).toEqual(['build', 'preview', 'test', 'lint', 'typecheck', 'start', 'dev', 'package'])
  })

  it('runs nothing when the user cancels either question', async () => {
    const run = jest.fn()

    await runTarget({ session: session(), prompter: scriptedPrompter([undefined]).prompter, run })
    await runTarget({ session: session(), prompter: scriptedPrompter(['web', undefined]).prompter, run })

    expect(run).not.toHaveBeenCalled()
  })

  it('says so when there is no project to pick from', async () => {
    await expect(runTarget({ session: session([]), prompter: scriptedPrompter([]).prompter, run: jest.fn() })).rejects.toThrow(/no projects/)
  })
})
