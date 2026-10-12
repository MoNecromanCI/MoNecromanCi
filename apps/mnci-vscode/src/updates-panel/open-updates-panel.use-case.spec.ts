import type { CliLocation } from '../cli-access'
import type { UpdateReport } from '../cli-contracts'
import { openUpdatesPanel, type UpdatesSurface } from './open-updates-panel.use-case'

const LOCATION: CliLocation = { command: 'mnci', prefix: [], source: 'global' } as CliLocation

const REPORT: UpdateReport = {
  updates: [
    { name: 'axios', ecosystem: 'npm', kind: 'minor', current: '1.7.2', latest: '1.9.0', projects: ['packages/a'], sections: ['dep'] },
    { name: 'ms', ecosystem: 'npm', kind: 'patch', current: '2.0.0', latest: '2.0.1', projects: ['(root)'], sections: ['devDep'] },
  ],
}

function setup (overrides: { workspaceRoot?: string | undefined, run?: jest.Mock } = {}): {
  surface:       jest.Mocked<UpdatesSurface> & { post: (message: unknown) => void }
  run:           jest.Mock
  runInTerminal: jest.Mock
  open:          () => Promise<void>
} {
  let handler: ((message: unknown) => void) | undefined
  const surface = {
    showMessage: jest.fn(),
    showUpdates: jest.fn(),
    onMessage:   jest.fn((next: (message: unknown) => void) => { handler = next }),
    tell:        jest.fn(),
    post:        (message: unknown) => { handler?.(message) },
  } as unknown as jest.Mocked<UpdatesSurface> & { post: (message: unknown) => void }
  const run = overrides.run ?? jest.fn().mockResolvedValue({ value: REPORT, exitCode: 0 })
  const runInTerminal = jest.fn()
  const workspaceRoot = 'workspaceRoot' in overrides ? overrides.workspaceRoot : '/w'

  return {
    surface,
    run,
    runInTerminal,
    open: async () => { await openUpdatesPanel({ location: () => LOCATION, workspaceRoot, run, runInTerminal, surface }) },
  }
}

describe('openUpdatesPanel', () => {
  it('asks the CLI for the JSON report in the workspace and shows it', async () => {
    const { surface, run, open } = setup()

    await open()

    expect(run).toHaveBeenCalledWith(LOCATION, ['up', '--json'], '/w', expect.any(Number))
    expect(surface.showUpdates).toHaveBeenCalledWith(REPORT)
  })

  it('runs `mnci up` with the chosen names in the terminal, and says where to look', async () => {
    const { surface, runInTerminal, open } = setup()
    await open()

    surface.post({ type: 'update', names: ['ms', 'axios'] })

    expect(runInTerminal).toHaveBeenCalledWith(['up', 'ms', 'axios'])
    expect(surface.tell).toHaveBeenCalledWith(expect.stringContaining('MNCI terminal'))
  })

  it('drops a name the report did not list, and a malformed message', async () => {
    const { surface, runInTerminal, open } = setup()
    await open()

    surface.post({ type: 'update', names: ['left-pad'] })
    surface.post({ type: 'update', names: ['--yes'] })
    surface.post('hello')

    expect(runInTerminal).not.toHaveBeenCalled()
  })

  it('asks again on refresh', async () => {
    const { surface, run, open } = setup()
    await open()

    surface.post({ type: 'refresh' })
    // The shared setup installs fake timers, so settle the pending promises by yielding, not by waiting.
    for (let turn = 0; turn < 5; turn++) {
      await Promise.resolve()
    }

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('says why when the CLI cannot answer, naming the version that can', async () => {
    const { surface, open } = setup({ run: jest.fn().mockRejectedValue(new Error("unknown option '--json'")) })

    await open()

    expect(surface.showUpdates).not.toHaveBeenCalled()
    expect(surface.showMessage).toHaveBeenLastCalledWith(expect.stringContaining('4.99.0'))
  })

  it('asks for a workspace when none is open, and runs nothing', async () => {
    const { surface, run, open } = setup({ workspaceRoot: undefined })

    await open()

    expect(run).not.toHaveBeenCalled()
    expect(surface.showMessage).toHaveBeenCalledWith(expect.stringContaining('workspace'))
  })
})
