import * as vscode from 'vscode'
import type { CliSession } from '../cli-session'
import { isRelevantChange } from './is-relevant-change.algorithm'

/** How long to wait after the last change before refreshing, so an install is one refresh and not hundreds. */
const DEBOUNCE_MS = 800

/**
 * Refreshes the session when a project manifest changes, so the views follow `mnci add`.
 *
 * @remarks
 * The commands run in a terminal, so the extension is not told when they finish; the files
 * they write are the signal. Changes are debounced and filtered by {@link isRelevantChange}.
 *
 * @param session - The session to refresh.
 * @returns What to dispose when the extension deactivates.
 * @throws Never - watching is best effort.
 * @typeParam None - this function has no generic type parameters.
 */
export function watchWorkspace (session: CliSession): vscode.Disposable[] {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*')
  let timer: ReturnType<typeof setTimeout> | undefined
  const onChange = (uri: vscode.Uri): void => {
    if (!isRelevantChange(uri.fsPath)) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => { session.refresh() }, DEBOUNCE_MS)
  }

  return [
    watcher,
    watcher.onDidCreate(onChange),
    watcher.onDidChange(onChange),
    watcher.onDidDelete(onChange),
    new vscode.Disposable(() => { clearTimeout(timer) }),
  ]
}
