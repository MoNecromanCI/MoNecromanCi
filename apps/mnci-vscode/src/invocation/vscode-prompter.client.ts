import * as vscode from 'vscode'
import type { PickEntry, PickItem, Prompter } from './prompter.contract'

/**
 * Turns a pick entry into a VS Code quick-pick item.
 *
 * @param entry - A choice or a heading.
 * @returns The item, with its value kept alongside.
 */
function toQuickPickItem (entry: PickEntry): vscode.QuickPickItem & { value?: string } {
  if ('separator' in entry) {
    return { label: entry.separator, kind: vscode.QuickPickItemKind.Separator }
  }

  return { label: entry.label, description: entry.description, detail: entry.detail, value: entry.value }
}

/**
 * The real prompter, on VS Code's quick picks, input boxes and folder dialog.
 *
 * @remarks
 * Everything here is a thin adapter: the decisions are in the flows that call it.
 */
export const VSCODE_PROMPTER: Prompter = {
  async pickOne (entries, placeholder) {
    const picked = await vscode.window.showQuickPick(entries.map(entry => toQuickPickItem(entry)), { placeHolder: placeholder, matchOnDescription: true, matchOnDetail: true })

    return (picked as { value?: string } | undefined)?.value
  },
  async pickMany (entries: readonly PickItem[], placeholder) {
    const picked = await vscode.window.showQuickPick(entries.map(entry => toQuickPickItem(entry)), { placeHolder: placeholder, canPickMany: true, matchOnDescription: true })

    return picked?.map(item => (item as { value?: string }).value ?? item.label)
  },
  async askText (prompt, options) {
    return await vscode.window.showInputBox({
      prompt,
      placeHolder:    options?.placeholder,
      ignoreFocusOut: true,
      validateInput:  options?.required === true ? value => (value.trim() === '' ? 'A value is required.' : undefined) : undefined,
    })
  },
  async pickFolder (title) {
    const picked = await vscode.window.showOpenDialog({ title, canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Select' })

    return picked?.[0]?.fsPath
  },
}
