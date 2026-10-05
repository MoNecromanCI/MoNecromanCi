// Stands in for the 'vscode' module in unit tests: that module exists only
// inside the extension host. Extend it as the extension reaches for more API.

const registered = new Map<string, (...arguments_: unknown[]) => unknown>()

/**
 * Everything the extension showed or created, for a test to read.
 *
 * @remarks
 * A test reads it to see what the extension showed or ran, since the real editor is not there.
 */
export const recorded: { errors: string[], infos: string[], warnings: string[], terminalLines: string[], contexts: Array<[string, unknown]> } = {
  errors: [], infos: [], warnings: [], terminalLines: [], contexts: [],
}

/**
 * Empties {@link recorded} between tests.
 *
 * @remarks
 * Called before each test that reads {@link recorded}.
 * @param None - this function takes no parameters.
 * @returns Nothing.
 * @throws Never - it only empties arrays.
 * @typeParam None - this function has no generic type parameters.
 */
export function resetRecorded (): void {
  recorded.errors.length = 0
  recorded.infos.length = 0
  recorded.warnings.length = 0
  recorded.terminalLines.length = 0
  recorded.contexts.length = 0
}

/**
 * Registered commands, as `vscode.commands`.
 *
 * @remarks
 * `executeCommand('setContext', …)` is recorded, as VS Code treats it as a built-in.
 */
export const commands = {
  registerCommand (id: string, handler: (...arguments_: unknown[]) => unknown): { dispose: () => void } {
    registered.set(id, handler)

    return { dispose: () => { registered.delete(id) } }
  },
  getCommands (): Promise<string[]> {
    return Promise.resolve(registered.keys().toArray())
  },
  executeCommand (id: string, ...arguments_: unknown[]): Promise<unknown> {
    if (id === 'setContext') {
      recorded.contexts.push([arguments_[0] as string, arguments_[1]])
    }

    return Promise.resolve(registered.get(id)?.(...arguments_))
  },
}

/** A terminal that records the lines sent to it. */
class StubTerminal {
  readonly creationOptions: { name: string, cwd?: string }

  constructor (options: { name: string, cwd?: string }) {
    this.creationOptions = options
  }

  get name (): string {
    return this.creationOptions.name
  }

  show (): void {}

  sendText (line: string): void {
    recorded.terminalLines.push(line)
  }
}

const terminals: StubTerminal[] = []

/** Messages, pickers and terminals, as `vscode.window`.

@remarks
Only the parts the extension calls: messages, terminals and tree views.
 */
export const window = {
  terminals,
  showInformationMessage (message: string): Promise<undefined> {
    recorded.infos.push(message)

    return Promise.resolve(undefined)
  },
  showWarningMessage (message: string): Promise<undefined> {
    recorded.warnings.push(message)

    return Promise.resolve(undefined)
  },
  showErrorMessage (message: string): Promise<undefined> {
    recorded.errors.push(message)

    return Promise.resolve(undefined)
  },
  createTerminal (options: { name: string, cwd?: string }): StubTerminal {
    const terminal = new StubTerminal(options)
    terminals.push(terminal)

    return terminal
  },
  createTreeView (_id: string, _options: unknown): { dispose: () => void } {
    return { dispose: () => {} }
  },
}

/**
 The user's shell.

@remarks
Only the shell, which decides how a command line is quoted.
 */
export const env = { shell: '/bin/bash' }

/**
 A disposable that runs a callback.

@remarks
Runs its callback when disposed.
@typeParam None - this class has no generic type parameters.
 */
export class Disposable {
  constructor (private readonly callback: () => void) {}

  dispose (): void {
    this.callback()
  }
}

/**
 An event source with subscribe and fire.

@remarks
Delivers a fired value to every listener, synchronously.
@typeParam None - this class has no generic type parameters.
 */
export class EventEmitter<T> {
  private readonly listeners: Array<(value: T) => void> = []

  event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener)

    return new Disposable(() => {})
  }

  fire (value: T): void {
    for (const listener of this.listeners) {
      listener(value)
    }
  }
}

/**
 Whether a tree item can be expanded.

@remarks
The numbers match the real enum.
 */
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 }

/**
 A row of a tree view.

@remarks
A plain holder of the fields the sidebar sets.
@typeParam None - this class has no generic type parameters.
 */
export class TreeItem {
  id?:           string
  description?:  string
  tooltip?:      string
  contextValue?: string
  iconPath?:     unknown
  command?:      unknown

  constructor (public label: string, public collapsibleState: number) {}
}

/**
 A built-in icon by name.

@remarks
Holds only the icon name.
@typeParam None - this class has no generic type parameters.
 */
export class ThemeIcon {
  constructor (public id: string) {}
}

/**
 Kinds of quick-pick entries.

@remarks
The numbers match the real enum; `Separator` marks a heading.
 */
export const QuickPickItemKind = { Separator: -1, Default: 0 }

/**
 A file location.

@remarks
Only `file`, which is the one constructor the extension uses.
 */
export const Uri = { file: (path: string): { fsPath: string } => ({ fsPath: path }) }

/**
 A span of text.

@remarks
Holds the four numbers of a span.
@typeParam None - this class has no generic type parameters.
 */
export class Range {
  constructor (public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {}
}

/**
 A position in a file.

@remarks
Pairs a file with a span.
@typeParam None - this class has no generic type parameters.
 */
export class Location {
  constructor (public uri: unknown, public range: unknown) {}
}

/**
 * Severities of a diagnostic.
 *
 * @remarks
 * The numbers match the real enum.
 */
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 }

/**
 * A pointer to where else to look for a diagnostic.
 *
 * @remarks
 * Holds a location and a message; the extension puts the remedy there.
 * @typeParam None - this class has no generic type parameters.
 */
export class DiagnosticRelatedInformation {
  constructor (public location: unknown, public message: string) {}
}

/**
 * A problem in the Problems panel.
 *
 * @remarks
 * Holds a span, a message and a severity, with the optional fields the extension sets.
 * @typeParam None - this class has no generic type parameters.
 */
export class Diagnostic {
  source?:             string
  relatedInformation?: unknown[]

  constructor (public range: unknown, public message: string, public severity: number) {}
}

/** A set of diagnostics by file. */
class StubDiagnosticCollection {
  readonly entries = new Map<string, unknown[]>()

  set (uri: { fsPath: string }, diagnostics: unknown[]): void {
    this.entries.set(uri.fsPath, diagnostics)
  }

  clear (): void {
    this.entries.clear()
  }

  dispose (): void {}
}

/**
 * Language features, as `vscode.languages`.
 *
 * @remarks
 * Only `createDiagnosticCollection`, for the doctor results.
 */
export const languages = {
  createDiagnosticCollection (_name: string): StubDiagnosticCollection {
    return new StubDiagnosticCollection()
  },
}

/**
 * The open folders and settings, as `vscode.workspace`.
 *
 * @remarks
 * No folder is open and no file matches, so the extension starts as it would in an empty window.
 */
export const workspace = {
  workspaceFolders:        undefined as undefined | Array<{ uri: { fsPath: string } }>,
  getConfiguration:        (_section: string): { get: <T>(key: string) => T | undefined } => ({ get: () => {} }),
  findFiles:               (_glob: string): Promise<unknown[]> => Promise.resolve([]),
  createFileSystemWatcher: (_glob: string): { onDidCreate: () => Disposable, onDidChange: () => Disposable, onDidDelete: () => Disposable, dispose: () => void } => ({
    onDidCreate: () => new Disposable(() => {}),
    onDidChange: () => new Disposable(() => {}),
    onDidDelete: () => new Disposable(() => {}),
    dispose:     () => {},
  }),
  onDidChangeConfiguration: (_listener: unknown): Disposable => new Disposable(() => {}),
}
