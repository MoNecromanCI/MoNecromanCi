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
 * Decides how to update the mnci CLI the extension is using.
 *
 * @remarks
 * Each source updates differently: a workspace install is a dev dependency of that workspace,
 * a global install is updated globally, `npx` always fetches the newest so there is nothing to
 * do, and a path set by hand is the user's own.
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
      return { reason: 'mnci is fetched with npx, which always runs the newest version: nothing to update.' }
    }
    case 'setting': {
      return { reason: `mnci is run from ${location.command} (the mnci.cliPath setting). Update it where it was installed.` }
    }
  }
}
