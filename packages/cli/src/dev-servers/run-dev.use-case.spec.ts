// Mocked because the flow asks through @inquirer/prompts, which ships ESM only and which Jest cannot load.
// Every question here is answered through the dependencies instead.
jest.mock('@inquirer/prompts', () => ({ checkbox: jest.fn() }))
jest.mock('../terminal', () => ({ logger: { info: jest.fn() } }))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunningProject } from './spawn-project.client'
import { runDev, type DevDependencies } from './run-dev.use-case'
import { listStartableProjects } from './startable-projects.use-case'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-dev-'))
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({
    scripts: { 'web:start': 'nx run web:serve', 'api:start': 'nx run api:serve', 'svc:start': 'nx run svc:start', 'api:qa': 'x', 'core:qa': 'x' },
  }))
  process.exitCode = undefined
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  process.exitCode = undefined
})

/** Stands in for a fake's exit function until its promise has been created. */
const NOT_YET = (): void => undefined

/** Lets the async selection in `runDev` finish, so what it started can be looked at. */
async function settle (): Promise<void> {
  await new Promise(resolve => { setImmediate(resolve) })
}

/** A fake running project that stops when told to, or when the test makes it exit. */
interface Fake extends RunningProject {
  project: string
  target:  string
  stopped: boolean
  exit:    (status: number) => void
  say:     (line: string) => void
}

/** Dependencies whose projects are fakes the test controls. */
function fakes (change: Partial<DevDependencies> = {}): { dependencies: Partial<DevDependencies>, started: Fake[], printed: string[] } {
  const started: Fake[] = []
  const printed: string[] = []

  return {
    started,
    printed,
    dependencies: {
      interactive: false,
      print:       line => { printed.push(line) },
      start:       (project, target, onLine) => {
        // The typecheck project's lib is ES2023 on purpose, which has no Promise.withResolvers.
        let finish: (status: number) => void = NOT_YET
        // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
        const promise = new Promise<number>(resolve => { finish = resolve })
        const fake: Fake = {
          project,
          target,
          stopped: false,
          exited:  promise,
          exit:    status => { finish(status) },
          say:     onLine,
          stop:    () => {
            fake.stopped = true
            finish(0)
          },
        }
        started.push(fake)

        return fake
      },
      ...change,
    },
  }
}

describe('listStartableProjects', () => {
  it('lists each project with the target its start script runs, and not a library with only a qa', () => {
    expect(listStartableProjects(workspaceRoot)).toEqual([
      { project: 'api', target: 'serve' },
      { project: 'svc', target: 'start' },
      { project: 'web', target: 'serve' },
    ])
  })

  it('lists none for a workspace with no manifest', () => {
    rmSync(join(workspaceRoot, 'package.json'))

    expect(listStartableProjects(workspaceRoot)).toEqual([])
  })
})

describe('runDev', () => {
  it('starts every named project with its own target, prefixing what each prints', async () => {
    const { dependencies, started, printed } = fakes()
    const done = runDev(workspaceRoot, ['web', 'svc'], {}, dependencies)
    await settle()

    expect(started.map(each => `${each.project}:${each.target}`)).toEqual(['svc:start', 'web:serve'])
    started[0].say('listening')
    started[1].say('ready')
    started[1].exit(0)
    await done

    expect(printed).toEqual(['[svc] listening', '[web] ready'])
  })

  it('stops the rest when one stops, and passes on its status', async () => {
    const { dependencies, started } = fakes()
    const done = runDev(workspaceRoot, ['web', 'api'], {}, dependencies)
    await settle()

    started.find(each => each.project === 'api')?.exit(2)
    await done

    expect(started.find(each => each.project === 'web')?.stopped).toBe(true)
    expect(process.exitCode).toBe(2)
  })

  it('starts everything that can be started with --all', async () => {
    const { dependencies, started } = fakes()
    const done = runDev(workspaceRoot, [], { all: true }, dependencies)
    await settle()

    expect(started.map(each => each.project)).toEqual(['api', 'svc', 'web'])
    started[0].exit(0)
    await done
  })

  it('asks a person which to start when none are named, and starts those', async () => {
    const { dependencies, started } = fakes({ interactive: true, choose: async () => ['web'] })
    const done = runDev(workspaceRoot, [], {}, dependencies)
    await settle()

    expect(started.map(each => each.project)).toEqual(['web'])
    started[0].exit(0)
    await done
  })

  it('tells a script to name the projects instead of waiting for an answer', async () => {
    await expect(runDev(workspaceRoot, [], {}, fakes().dependencies)).rejects.toThrow('Name the projects to start, or pass --all. Startable: api, svc, web.')
  })

  it('refuses a name that cannot be started, with the list that can, and starts nothing', async () => {
    const { dependencies, started } = fakes()

    await expect(runDev(workspaceRoot, ['web', 'core'], {}, dependencies)).rejects.toThrow('Cannot start core: not a project with a start command. Startable: api, svc, web.')
    expect(started).toEqual([])
  })

  it('prints and starts nothing on a dry run', async () => {
    const { dependencies, started } = fakes()

    await runDev(workspaceRoot, ['web'], { dryRun: true }, dependencies)

    expect(started).toEqual([])
  })

  it('says there is nothing to start in a workspace with no apps', async () => {
    writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ scripts: { 'core:qa': 'x' } }))

    await expect(runDev(workspaceRoot, [], { all: true }, fakes().dependencies)).rejects.toThrow('No project here has a start command')
  })
})
