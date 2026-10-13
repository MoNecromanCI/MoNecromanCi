import type { CliLocation } from '../cli-access'

/**
 * What to run to update the CLI, or why nothing can be run.
 *
 * @remarks
 * Exactly one of `run` and `reason` is set.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CliUpdatePlan {
  readonly run?:    { readonly command: string, readonly arguments_: readonly string[], readonly cwd: string | undefined }
  /** Why no command is offered: the user has to act, or nothing needs doing. */
  readonly reason?: string
}

/**
 * Decides how to bring the workspace's own `@mnci/cli` to the newest version.
 *
 * @remarks
 * Always an install into the workspace, so `package.json` and the lockfile carry the version the team runs.
 *
 * @param workspaceRoot - The open workspace folder, if any.
 * @returns The command to run, or the reason there is none.
 * @throws Never - pure decision.
 * @typeParam None - this function has no generic type parameters.
 */
export function planWorkspaceUpdate (workspaceRoot: string | undefined): CliUpdatePlan {
  if (workspaceRoot === undefined) {
    return { reason: 'Open a workspace folder first: there is no package.json to update.' }
  }

  return { run: { command: 'npm', arguments_: ['install', '--save-dev', '@mnci/cli@latest'], cwd: workspaceRoot } }
}

/**
 * Decides how to update the mnci CLI the extension is using.
 *
 * @remarks
 * Each source updates differently: a workspace install is a dev dependency of that workspace,
 * a global install is updated globally, the `npx` fallback is replaced by installing it into the
 * workspace (so its `package.json` names the version), and a path set by hand is the user's own.
 *
 * @param location - Where the CLI was found.
 * @param workspaceRoot - The workspace folder, when one is open.
 * @returns The command to run, or the reason there is none.
 * @throws Never - pure decision.
 * @typeParam None - this function has no generic type parameters.
 */
export function planCliUpdate (location: CliLocation, workspaceRoot: string | undefined): CliUpdatePlan {
  switch (location.source) {
    case 'workspace': {
      return { run: { command: 'npm', arguments_: ['install', '--save-dev', '@mnci/cli@latest'], cwd: workspaceRoot } }
    }
    case 'path': {
      return { run: { command: 'npm', arguments_: ['install', '--global', '@mnci/cli@latest'], cwd: workspaceRoot } }
    }
    case 'npx': {
      // No copy is installed (or the declared one is not in node_modules), so the update is to install it: the workspace
      // then runs the version its package.json names, as the rest of the team does. Outside a workspace there is no
      // package.json to write, and refreshing what npx runs is all there is.
      if (workspaceRoot !== undefined) {
        return { run: { command: 'npm', arguments_: ['install', '--save-dev', '@mnci/cli@latest'], cwd: workspaceRoot } }
      }

      return { run: { command: 'npx', arguments_: ['--yes', '@mnci/cli@latest', '--version'], cwd: undefined } }
    }
    case 'setting': {
      return { reason: `mnci is run from ${location.command} (the mnci.cliPath setting). Update it where it was installed.` }
    }
  }
}
