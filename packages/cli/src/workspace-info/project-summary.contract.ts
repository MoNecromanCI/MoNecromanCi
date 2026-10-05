import type { Ecosystem } from '../dependency-management'

/**
 * One project of the workspace, as an editor lists it.
 *
 * @remarks
 * Built by `listProjects` from the manifests on disk, without starting Nx.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ProjectSummary {
  /** The name to pass to `nx run <name>:<target>` (the directory's basename). */
  readonly name:      string
  /** Workspace-relative directory, forward-slashed. */
  readonly dir:       string
  readonly ecosystem: Ecosystem
  /** The `type:*` tag mnci put on the project (`go-app`, `vscode-extension`), when it has one. */
  readonly kind?:     string
  /** The project's Nx targets that mnci writes explicitly, from its `project.json`. */
  readonly targets:   readonly string[]
}

/**
 * What `mnci info` reports about the CLI and the workspace it ran in.
 *
 * @remarks
 * Built by `readWorkspaceInfo`; the workspace half is `null` outside a workspace.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface WorkspaceInfo {
  readonly cli:       {
    readonly version:         string
    /** The newest published version, or `null` when the registry did not answer. */
    readonly latest:          string | null
    readonly updateAvailable: boolean
  }
  /** `null` when run outside a workspace (no `nx.json`). */
  readonly workspace: {
    readonly root:   string
    readonly config: Record<string, unknown>
  } | null
}
