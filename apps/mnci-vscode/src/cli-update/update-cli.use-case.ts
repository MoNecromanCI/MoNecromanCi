import type { CliSession } from '../cli-session'
import { planCliUpdate } from './plan-cli-update.algorithm'

/**
 * What updating the CLI needs from the editor.
 *
 * @remarks
 * `confirm` shows the exact command and resolves `true` only when the user agrees. `run`
 * starts it in a terminal, and `tell` shows a message.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdateSurface {
  readonly confirm: (message: string) => Promise<boolean>
  readonly run:     (command: string, arguments_: readonly string[], cwd: string | undefined) => void
  readonly tell:    (message: string) => void
}

/**
 * Updates the mnci CLI after the user has seen the command and agreed to it.
 *
 * @remarks
 * Changes the machine (a global install) or the workspace's manifest (a dev dependency), so it
 * never runs without a confirmation that shows the exact command. When the CLI is run by
 * `npx` or from a path the user set, it says why there is nothing to do.
 *
 * @param session - The session, for where the CLI was found.
 * @param surface - How to confirm, run and tell.
 * @returns Nothing.
 * @throws Never - declining is a result.
 * @typeParam None - this function has no generic type parameters.
 */
export async function updateCli (session: CliSession, surface: UpdateSurface): Promise<void> {
  const plan = planCliUpdate(session.location(), session.workspaceRoot)
  if (plan.run === undefined) {
    surface.tell(plan.reason ?? 'There is nothing to update.')

    return
  }
  const line = [plan.run.command, ...plan.run.arguments_].join(' ')
  if (await surface.confirm(`Run "${line}"${plan.run.cwd ? ` in ${plan.run.cwd}` : ''}?`)) {
    surface.run(plan.run.command, plan.run.arguments_, plan.run.cwd)
  }
}
