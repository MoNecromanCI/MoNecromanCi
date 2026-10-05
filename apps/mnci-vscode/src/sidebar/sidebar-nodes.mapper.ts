import type { CliLocation } from '../cli-access'
import type { CommandDescription, CommandGroup, ProjectSummary, WorkspaceInfo } from '../cli-contracts'

/**
 * A row of a sidebar tree, free of any VS Code type so it can be built and tested without the editor.
 *
 * @remarks
 * `command` is the VS Code command id the row runs when clicked, with its `arguments_`.
 * `contextValue` lets `package.json` attach menu items to a kind of row.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface SidebarNode {
  readonly id:            string
  readonly label:         string
  readonly description?:  string
  readonly tooltip?:      string
  readonly contextValue?: string
  /** Codicon name (`rocket`), shown before the label. */
  readonly icon?:         string
  readonly command?:      { readonly id: string, readonly arguments_?: readonly unknown[] }
  readonly children?:     readonly SidebarNode[]
}

/** The groups the commands view lists, in order, with the heading and icon of each. */
const GROUPS: ReadonlyArray<readonly [CommandGroup, string, string]> = [
  ['workspace', 'Workspace', 'folder-library'],
  ['projects', 'Projects', 'package'],
  ['dependencies', 'Dependencies', 'references'],
  ['pipeline', 'Pipeline', 'rocket'],
]

/**
 * Shortens a command description to what fits beside its name.
 *
 * @remarks
 * Cuts at the first full stop, dash or colon-led clause, then at 60 characters. The full text
 * stays in the tooltip.
 *
 * @param description - The CLI's description.
 * @returns A short form, without a trailing full stop.
 * @throws Never - pure string work.
 * @typeParam None - this function has no generic type parameters.
 */
export function summarise (description: string): string {
  const firstClause = description.split(/\.\s|\s[—–-]\s|: /, 1)[0]?.trim() ?? ''
  const text = firstClause.replace(/\.$/, '')

  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text
}

/**
 * Builds the commands view: one heading per group, each holding its commands.
 *
 * @remarks
 * The commands the CLI marks `inspect` (the machine-readable ones) are not listed. A group
 * with no command is left out. A row runs the extension command `mnci.<name>`.
 *
 * @param commands - What `mnci commands --json` returned.
 * @returns The roots of the tree.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
export function commandNodes (commands: readonly CommandDescription[]): SidebarNode[] {
  return GROUPS.flatMap(([group, label, icon]): SidebarNode[] => {
    const inGroup = commands.filter(command => command.group === group)
    if (inGroup.length === 0) {
      return []
    }

    return [{
      id:       `group:${group}`,
      label,
      icon,
      children: inGroup.map((command): SidebarNode => ({
        id:          `command:${command.name}`,
        label:       command.name,
        description: summarise(command.description),
        tooltip:     command.description,
        icon:        'play',
        command:     { id: `mnci.${command.name}` },
      })),
    }]
  })
}

/**
 * Builds the projects view: each project, with its explicit targets beneath it.
 *
 * @remarks
 * A project with no explicit targets has no children; Nx still runs its inferred ones from the "Run a project target" command.
 *
 * @param projects - What `mnci projects --json` returned.
 * @returns The roots of the tree.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
export function projectNodes (projects: readonly ProjectSummary[]): SidebarNode[] {
  return projects.map((project): SidebarNode => ({
    id:           `project:${project.dir}`,
    label:        project.name,
    description:  `${project.dir} · ${project.ecosystem}${project.kind ? ` · ${project.kind}` : ''}`,
    tooltip:      `${project.dir}\n${project.ecosystem}${project.kind ? `, ${project.kind}` : ''}`,
    contextValue: 'mnci.project',
    icon:         'symbol-package',
    children:     project.targets.map((target): SidebarNode => ({
      id:      `target:${project.dir}:${target}`,
      label:   target,
      icon:    'debug-start',
      command: { id: 'mnci.runTarget', arguments_: [project.name, target] },
    })),
  }))
}

/**
 * Builds the update view: the installed CLI, whether a newer one exists, and the workspace.
 *
 * @remarks
 * When an update is available the row runs `mnci.updateCli`. `source` says where the
 * installed CLI came from, which decides how it is updated.
 *
 * @param info - What `mnci info --json` returned.
 * @param location - Where the CLI was found.
 * @returns The rows.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
export function updateNodes (info: WorkspaceInfo, location: CliLocation): SidebarNode[] {
  const sources: Record<CliLocation['source'], string> = {
    setting:   'from the mnci.cliPath setting',
    workspace: "this workspace's own install",
    path:      'global install',
    npx:       'fetched with npx',
  }
  const latest: SidebarNode = info.cli.latest === null
    ? { id: 'latest', label: 'Latest version', description: 'unknown (offline?)', icon: 'question' }
    : (info.cli.updateAvailable
        ? { id: 'latest', label: `Update to ${info.cli.latest}`, description: 'click to update', icon: 'arrow-circle-up', command: { id: 'mnci.updateCli' } }
        : { id: 'latest', label: 'Up to date', description: info.cli.latest, icon: 'check' })
  const workspace: SidebarNode = info.workspace === null
    ? { id: 'workspace', label: 'Workspace', description: 'none open', icon: 'folder' }
    : { id: 'workspace', label: 'Workspace', description: info.workspace.root, icon: 'folder-active', tooltip: JSON.stringify(info.workspace.config, null, 2) }

  return [
    { id: 'installed', label: `mnci ${info.cli.version}`, description: sources[location.source], icon: 'tag' },
    latest,
    workspace,
  ]
}
