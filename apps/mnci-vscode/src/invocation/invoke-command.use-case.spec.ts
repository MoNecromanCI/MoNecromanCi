import type { CommandDescription } from '../cli-contracts'
import type { CliSession } from '../cli-session'
import { invokeCommand } from './invoke-command.use-case'
import { scriptedPrompter } from './testing/scripted-prompter.mock'

const COMMANDS: CommandDescription[] = ['doctor', 'add', 'install', 'new'].map(name => ({ name, aliases: [], group: 'workspace', description: 'd', arguments: [], options: [] }))

/** A session answering from fixed data. */
function session (workspaceRoot: string | undefined): CliSession {
  return {
    workspaceRoot,
    commands: () => Promise.resolve(COMMANDS),
    kinds:    () => Promise.resolve([{ kind: 'go-app', language: 'go', label: 'Go app', description: 'd', flags: [] }]),
    projects: () => Promise.resolve([{ name: 'web', dir: 'apps/web', ecosystem: 'npm', targets: [] }]),
  } as unknown as CliSession
}

describe('invokeCommand', () => {
  it('runs a command that needs nothing asked', async () => {
    const run = jest.fn()

    await invokeCommand('doctor', { session: session('/ws'), prompter: scriptedPrompter([]).prompter, run })

    expect(run).toHaveBeenCalledWith({ arguments: ['doctor'], cwd: undefined })
  })

  it('uses the add flow for add, so the kinds come from the CLI', async () => {
    const run = jest.fn()

    await invokeCommand('add', { session: session('/ws'), prompter: scriptedPrompter(['go-app', 'svc', []]).prompter, run })

    expect(run).toHaveBeenCalledWith({ arguments: ['add', 'go-app', 'svc'] })
  })

  it('uses the install flow for install, so the projects come from the workspace', async () => {
    const run = jest.fn()

    await invokeCommand('install', { session: session('/ws'), prompter: scriptedPrompter(['restore']).prompter, run })

    expect(run).toHaveBeenCalledWith({ arguments: ['install'] })
  })

  it('runs nothing when the user cancels', async () => {
    const run = jest.fn()

    await invokeCommand('add', { session: session('/ws'), prompter: scriptedPrompter([undefined]).prompter, run })

    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a command that needs a workspace when none is open, saying what to do', async () => {
    await expect(invokeCommand('doctor', { session: session(undefined), prompter: scriptedPrompter([]).prompter, run: jest.fn() })).rejects.toThrow(/Open a folder.*New workspace/)
  })

  it('lets `new` run with no workspace open', async () => {
    const run = jest.fn()

    await invokeCommand('new', { session: session(undefined), prompter: scriptedPrompter(['C:/dev']).prompter, run })

    expect(run).toHaveBeenCalledWith({ arguments: ['new'], cwd: 'C:/dev' })
  })

  it('names the way out when the installed CLI lacks the command', async () => {
    await expect(invokeCommand('upgrade', { session: session('/ws'), prompter: scriptedPrompter([]).prompter, run: jest.fn() })).rejects.toThrow(/no "upgrade" command.*Update mnci/)
  })
})
