import type { CliSession } from '../cli-session'
import { updateCli, type UpdateSurface } from './update-cli.use-case'

/** A session whose CLI was found from a given source. */
function session (source: 'workspace' | 'npx'): CliSession {
  return { location: () => ({ command: 'mnci', prefix: [], source }), workspaceRoot: '/ws' } as unknown as CliSession
}

/** A surface that records what it was asked, and answers the confirmation as told. */
function surface (agrees: boolean): UpdateSurface & { run: jest.Mock, tell: jest.Mock, confirm: jest.Mock } {
  return { confirm: jest.fn(() => Promise.resolve(agrees)), run: jest.fn(), tell: jest.fn() }
}

describe('updateCli', () => {
  it('shows the exact command and runs it only when the user agrees', async () => {
    const ui = surface(true)

    await updateCli(session('workspace'), ui)

    expect(ui.confirm).toHaveBeenCalledWith('Run "npm install --save-dev @mnci/cli@latest" in /ws?')
    expect(ui.run).toHaveBeenCalledWith('npm', ['install', '--save-dev', '@mnci/cli@latest'], '/ws')
  })

  it('runs nothing when the user declines', async () => {
    const ui = surface(false)

    await updateCli(session('workspace'), ui)

    expect(ui.run).not.toHaveBeenCalled()
  })

  it('explains, without asking, when there is nothing to run', async () => {
    const ui = surface(true)

    await updateCli(session('npx'), ui)

    expect(ui.confirm).not.toHaveBeenCalled()
    expect(ui.tell).toHaveBeenCalledWith(expect.stringMatching(/nothing to update/))
  })
})
