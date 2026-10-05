import type { ProjectSummary } from '../cli-contracts'
import { buildArguments, type OptionChoice } from './build-arguments.algorithm'
import { words, type Invocation } from './collect-invocation.use-case'
import type { Prompter } from './prompter.contract'

/**
 * Collects `mnci install`: add packages to chosen projects, or restore the whole workspace.
 *
 * @remarks
 * A package needs a target project (the CLI refuses to add to the root), so the projects are
 * offered from the workspace's own list instead of being typed. The option goes after the
 * packages, because `--workspace` is variadic.
 *
 * @param projects - The workspace's projects.
 * @param prompter - How to ask.
 * @returns What to run, or `undefined` when the user cancelled or chose no project.
 * @throws Error when the workspace has no project to add a package to.
 * @typeParam None - this function has no generic type parameters.
 */
export async function collectInstallInvocation (projects: readonly ProjectSummary[], prompter: Prompter): Promise<Invocation | undefined> {
  const mode = await prompter.pickOne(
    [
      { label: 'Add packages to projects', value: 'add', detail: 'Each project owns its dependencies, so pick where they go.' },
      { label: 'Install everything', value: 'restore', detail: 'Restore every ecosystem of the workspace from its manifests.' },
    ],
    'What should install do?',
  )
  if (mode === undefined) {
    return undefined
  }
  if (mode === 'restore') {
    return { arguments: ['install'] }
  }
  if (projects.length === 0) {
    throw new Error('This workspace has no projects to add a package to. Add one first.')
  }

  const packages = await prompter.askText('Packages to add, separated by spaces (a name, or name@version)', { required: true })
  if (packages === undefined) {
    return undefined
  }
  const targets = await prompter.pickMany(
    projects.map(project => ({ label: project.name, value: project.name, description: project.dir, detail: project.ecosystem })),
    'Add them to which projects?',
  )
  if (targets === undefined || targets.length === 0) {
    return undefined
  }
  const kind = await prompter.pickOne(
    [
      { label: 'Dependency', value: 'dependency' },
      { label: 'Development dependency', value: 'dev', detail: 'Only for ecosystems that distinguish one.' },
    ],
    'Which kind of dependency?',
  )
  if (kind === undefined) {
    return undefined
  }
  const options: OptionChoice[] = [{ name: 'workspace', value: targets, repeat: true }, ...(kind === 'dev' ? [{ name: 'save-dev' }] : [])]

  return { arguments: buildArguments('install', words(packages), options) }
}
