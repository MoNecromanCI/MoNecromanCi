import type { CliJsonResult, CliLocation } from '../cli-access'
import type { UpdateReport } from '../cli-contracts'
import { parseUpdatesMessage } from './parse-updates-message.algorithm'

/** The slow part of `mnci up --json` is one registry query per package; a large workspace needs minutes. */
const REPORT_TIMEOUT_MS = 600_000

/**
 * The webview and the editor, as the use case sees them.
 *
 * @remarks
 * The VS Code implementation is in `updates-panel.client.ts`; a test supplies a fake.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdatesSurface {
  /** Shows a message in place of the list (loading, or why there is none). */
  readonly showMessage: (text: string) => void
  /** Shows the list of updates. */
  readonly showUpdates: (report: UpdateReport) => void
  /** Registers the handler of what the page posts. */
  readonly onMessage:   (handler: (message: unknown) => void) => void
  /** Tells the person something in the editor. */
  readonly tell:        (message: string) => void
}

/**
 * What opening the panel needs from the outside.
 *
 * @remarks
 * Everything that touches the machine (the CLI process, the terminal, the webview) is injected, so the flow is
 * tested without VS Code.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdatesPanelDependencies {
  readonly location:      () => CliLocation
  readonly workspaceRoot: string | undefined
  readonly run:           (location: CliLocation, arguments_: readonly string[], cwd: string, timeoutMs: number) => Promise<CliJsonResult<UpdateReport>>
  /** Runs `mnci <arguments>` in the MNCI terminal, where its prompts and output stay visible. */
  readonly runInTerminal: (arguments_: readonly string[]) => void
  readonly surface:       UpdatesSurface
}

/**
 * Fills the updates panel from `mnci up --json` and carries out what it asks.
 *
 * @remarks
 * The CLI does the work and the panel only chooses: a selection becomes `mnci up <names...>` in the MNCI
 * terminal, so the install output and any failure are where the person already looks. A name the page posts that
 * the report did not list is dropped, because the page is a web page and its messages are data.
 *
 * @param dependencies - The CLI, the terminal and the page.
 * @returns A promise that resolves once the first report was shown (or why there was none).
 * @throws Never - a failed report is shown on the page.
 * @typeParam None - this function has no generic type parameters.
 */
export async function openUpdatesPanel (dependencies: UpdatesPanelDependencies): Promise<void> {
  const { surface } = dependencies
  let listed: ReadonlySet<string> = new Set()

  async function load (): Promise<void> {
    if (dependencies.workspaceRoot === undefined) {
      surface.showMessage('Open a folder that holds an mnci workspace first.')

      return
    }
    surface.showMessage('Looking up the latest release of every dependency. A large workspace takes a minute or two.')
    try {
      const { value } = await dependencies.run(dependencies.location(), ['up', '--json'], dependencies.workspaceRoot, REPORT_TIMEOUT_MS)
      listed = new Set(value.updates.map(update => update.name))
      surface.showUpdates(value)
    } catch (error) {
      surface.showMessage(`Could not list the updates: ${error instanceof Error ? error.message : String(error)}. The CLI needs to be 4.99.0 or newer for this view.`)
    }
  }

  surface.onMessage(message => {
    const request = parseUpdatesMessage(message)
    if (request === undefined) {
      return
    }
    if (request.type === 'refresh') {
      void load()

      return
    }
    const names = request.names.filter(name => listed.has(name))
    if (names.length === 0) {
      return
    }
    dependencies.runInTerminal(['up', ...names])
    surface.tell(`Updating ${names.length} package(s) in the MNCI terminal. Press Refresh in the panel when it has finished.`)
  })

  await load()
}
