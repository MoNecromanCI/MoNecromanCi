import * as vscode from 'vscode'
import { CLI_COMMAND_NAMES, commandId, EXTENSION_ONLY_COMMAND_NAMES } from './commands'
import { activate } from './main'

/** What the test stub records of what the extension did; `vscode` itself has none of this. */
const stub = vscode as unknown as {
  recorded:      { errors: string[], contexts: Array<[string, unknown]> }
  resetRecorded: () => void
}

/** An extension context that only collects disposables. */
function context (): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext
}

beforeEach(() => {
  stub.resetRecorded()
})

describe('activate', () => {
  it('registers every mnci command, the CLI ones and the extension\'s own', async () => {
    activate(context())

    const registered = await vscode.commands.getCommands()
    for (const name of [...CLI_COMMAND_NAMES, ...EXTENSION_ONLY_COMMAND_NAMES]) {
      expect(registered).toContain(commandId(name))
    }
  })

  it('hands everything it started to the context, so deactivating disposes it all', () => {
    const subject = context()

    activate(subject)

    // commands + diagnostics, three views, the watcher and its listeners, and the settings listener.
    expect(subject.subscriptions.length).toBeGreaterThan(10)
  })

  it('shows an error message, and does not throw, when a command fails', async () => {
    activate(context())

    // No workspace folder is open in the stub, so `add` cannot run.
    await vscode.commands.executeCommand('mnci.add')

    expect(stub.recorded.errors.some(message => /Open a folder/.test(message))).toBe(true)
  })

  it('tells the welcome views whether the folder holds a workspace', async () => {
    activate(context())
    await Promise.resolve()
    await Promise.resolve()

    expect(stub.recorded.contexts).toContainEqual(['mnci.isWorkspace', false])
  })
})
