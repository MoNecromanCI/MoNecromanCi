import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { UpdateReport } from '../cli-contracts'
import type { UpdatesSurface } from './open-updates-panel.use-case'
import { escapeHtml, renderUpdatesPage } from './render-updates-page.algorithm'

/** The panel's view type, so VS Code can tell it from any other webview. */
const VIEW_TYPE = 'mnci.updates'

let current: vscode.WebviewPanel | undefined
let handler: ((message: unknown) => void) | undefined

/**
 * Shows the updates webview, creating it on first use and reusing it afterwards.
 *
 * @remarks
 * One panel per window: a second request reveals it. The page's scripts are enabled and its only way to
 * talk to the extension is `postMessage`; it has no local resource roots because it loads none.
 *
 * @param None - this function takes no parameters.
 * @returns The surface the use case drives.
 * @throws Never - VS Code creates the panel.
 * @typeParam None - this function has no generic type parameters.
 */
export function showUpdatesPanel (): UpdatesSurface {
  if (current === undefined) {
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Dependency updates', vscode.ViewColumn.Active, {
      enableScripts:      true,
      localResourceRoots: [],
    })
    panel.onDidDispose(() => {
      current = undefined
      handler = undefined
    })
    panel.webview.onDidReceiveMessage((message: unknown) => { handler?.(message) })
    current = panel
  } else {
    current.reveal()
  }
  const panel = current

  return {
    showMessage: text => {
      const nonce = randomBytes(16).toString('base64')
      panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px}</style></head><body><p>${escapeHtml(text)}</p></body></html>`
    },
    showUpdates: (report: UpdateReport) => {
      panel.webview.html = renderUpdatesPage({
        updates:   report.updates,
        nonce:     randomBytes(16).toString('base64'),
        cspSource: panel.webview.cspSource,
      })
    },
    onMessage: next => { handler = next },
    tell:      message => { void vscode.window.showInformationMessage(message) },
  }
}
