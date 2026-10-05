import * as vscode from 'vscode'
import type { CliSession } from '../cli-session'
import { commandNodes, projectNodes, updateNodes, type SidebarNode } from './sidebar-nodes.mapper'

/**
 * Serves one sidebar view from a loader of {@link SidebarNode} rows.
 *
 * @remarks
 * A failed load becomes a single row saying so, which refreshes when clicked, so a CLI that
 * is missing or slow shows up in the view and not as a silent empty tree.
 */
class SidebarTreeProvider implements vscode.TreeDataProvider<SidebarNode> {
  private readonly changed = new vscode.EventEmitter<SidebarNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event

  constructor (private readonly load: () => Promise<SidebarNode[]>) {}

  /**
   * Tells the view to read its rows again.
   *
   * @returns Nothing.
   */
  refresh (): void {
    this.changed.fire(undefined)
  }

  /**
   * Turns a row into the VS Code tree item.
   *
   * @param node - The row.
   * @returns The tree item.
   */
  getTreeItem (node: SidebarNode): vscode.TreeItem {
    const hasChildren = (node.children?.length ?? 0) > 0
    const item = new vscode.TreeItem(node.label, hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None)
    item.id = node.id
    item.description = node.description
    item.tooltip = node.tooltip
    item.contextValue = node.contextValue
    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(node.icon)
    }
    if (node.command) {
      item.command = { command: node.command.id, title: node.label, arguments: [...(node.command.arguments_ ?? [])] }
    }

    return item
  }

  /**
   * Lists a row's children, or the roots.
   *
   * @param node - The parent row, or `undefined` for the roots.
   * @returns The rows.
   */
  async getChildren (node?: SidebarNode): Promise<SidebarNode[]> {
    if (node) {
      return [...(node.children ?? [])]
    }
    try {
      return await this.load()
    } catch (error) {
      return [{ id: 'error', label: 'Could not load', description: error instanceof Error ? error.message : String(error), icon: 'warning', command: { id: 'mnci.refresh' } }]
    }
  }
}

/**
 * Creates the three sidebar views and keeps them in step with the session.
 *
 * @remarks
 * The views are `mnci.commands`, `mnci.projects` and `mnci.update`, declared in `package.json`.
 * Each reads from the shared session, so one refresh updates all three.
 *
 * @param session - The CLI's cached answers.
 * @returns What to dispose when the extension deactivates.
 * @throws Never - a failed load shows in the view.
 * @typeParam None - this function has no generic type parameters.
 */
export function registerSidebarViews (session: CliSession): vscode.Disposable[] {
  const providers: Record<string, SidebarTreeProvider> = {
    'mnci.commands': new SidebarTreeProvider(async () => commandNodes(await session.commands())),
    'mnci.projects': new SidebarTreeProvider(async () => {
      const nodes = projectNodes(await session.projects())

      return nodes.length > 0 ? nodes : [{ id: 'none', label: 'No projects yet', description: 'add one', icon: 'add', command: { id: 'mnci.add' } }]
    }),
    'mnci.update': new SidebarTreeProvider(async () => updateNodes(await session.info(), session.location())),
  }
  const views = Object.entries(providers).map(([id, provider]) => vscode.window.createTreeView(id, { treeDataProvider: provider }))
  const unsubscribe = session.onDidChange(() => {
    for (const provider of Object.values(providers)) {
      provider.refresh()
    }
  })

  return [...views, new vscode.Disposable(unsubscribe)]
}
