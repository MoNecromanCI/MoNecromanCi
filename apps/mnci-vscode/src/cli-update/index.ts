/**
 * Updating the mnci CLI the extension uses.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { updateCli, updateWorkspaceCli, type UpdateSurface } from './update-cli.use-case'
export { readWorkspaceInstall } from './read-workspace-install.use-case'
export { workspaceInstallStatus } from './workspace-install-status.algorithm'
export type { WorkspaceInstall, WorkspaceInstallStatus } from './workspace-install.contract'
