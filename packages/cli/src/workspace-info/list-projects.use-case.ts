import { join } from 'node:path'
import { locateProjects } from '../dependency-management'
import { fileExists, readJson } from '../file-system'
import { logger, printJson } from '../terminal'
import type { ProjectSummary } from './project-summary.contract'

/**
 * Flags of `mnci projects`.
 *
 * @remarks
 * `mnci projects` has only the one flag.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ProjectsOptions {
  /** Print the projects as one JSON document, for an editor or a script. */
  json?: boolean
}

const TYPE_TAG_PREFIX = 'type:'

/**
 * Finds the projects of a workspace and what mnci recorded about each.
 *
 * @remarks
 * The projects come from `locateProjects` (every manifest of every ecosystem), the kind and
 * the targets from the project's own `project.json` when it has one. Nothing is asked of Nx,
 * which takes seconds to start; a list for a sidebar has to be quick.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The projects, sorted by directory.
 * @throws Error when a `project.json` exists but is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function listProjects (workspaceRoot: string): ProjectSummary[] {
  return locateProjects(workspaceRoot)
    .map((location): ProjectSummary => {
      const projectJsonPath = join(workspaceRoot, location.dir, 'project.json')
      const project = fileExists(projectJsonPath)
        ? readJson<{ tags?: string[], targets?: Record<string, unknown> }>(projectJsonPath)
        : {}
      const typeTag = (project.tags ?? []).find(tag => tag.startsWith(TYPE_TAG_PREFIX))

      return {
        name:      location.name,
        dir:       location.dir,
        ecosystem: location.ecosystem,
        kind:      typeTag?.slice(TYPE_TAG_PREFIX.length),
        targets:   Object.keys(project.targets ?? {}),
      }
    })
    .toSorted((a, b) => a.dir.localeCompare(b.dir))
}

/**
 * Prints the workspace's projects.
 *
 * @remarks
 * `--json` is what an editor's project tree is built from.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Error when `workspaceRoot` has no `nx.json`.
 * @typeParam None - this function has no generic type parameters.
 */
export function runProjects (workspaceRoot: string, options: ProjectsOptions): void {
  if (!fileExists(join(workspaceRoot, 'nx.json'))) {
    throw new Error('No nx.json found here. Run `projects` from the workspace root.')
  }
  const projects = listProjects(workspaceRoot)
  if (options.json === true) {
    printJson(projects)

    return
  }
  for (const project of projects) {
    logger.info(`${project.dir.padEnd(32)} ${project.ecosystem}${project.kind ? `  ${project.kind}` : ''}`)
  }
}
