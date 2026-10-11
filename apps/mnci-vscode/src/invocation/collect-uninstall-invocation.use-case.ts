import type { ProjectSummary } from '../cli-contracts'
import { buildArguments } from './build-arguments.algorithm'
import { words, type Invocation } from './collect-invocation.use-case'
import type { Prompter } from './prompter.contract'

/**
 * Collects `mnci uninstall`: remove packages from chosen projects.
 *
 * @remarks
 * The counterpart of `collectInstallInvocation`. A package is removed from the project that declares it, and the CLI
 * refuses one with no target, so the projects are offered from the workspace's own list. The option goes after the
 * packages, because `--workspace` is variadic.
 *
 * @param projects - The workspace's projects.
 * @param prompter - How to ask.
 * @returns What to run, or `undefined` when the user cancelled or chose no project.
 * @throws Error when the workspace has no project to remove a package from.
 * @typeParam None - this function has no generic type parameters.
 */
export async function collectUninstallInvocation (projects: readonly ProjectSummary[], prompter: Prompter): Promise<Invocation | undefined> {
  if (projects.length === 0) {
    throw new Error('This workspace has no projects to remove a package from.')
  }
  const targets = await prompter.pickMany(
    projects.map(project => ({ label: project.name, value: project.name, description: project.dir, detail: project.ecosystem })),
    'Remove packages from which projects?',
  )
  if (targets === undefined || targets.length === 0) {
    return undefined
  }
  const packages = await prompter.askText('Packages to remove, separated by spaces', { required: true })
  if (packages === undefined) {
    return undefined
  }

  return { arguments: buildArguments('uninstall', words(packages), [{ name: 'workspace', value: targets, repeat: true }]) }
}
