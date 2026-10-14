import { readdirSync } from 'node:fs'
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

/** The folders a project of no package ecosystem (`bicep-iac`) can sit in. */
const PROJECT_PARENTS = ['apps', 'packages', 'libs']

/**
 * Finds the projects that have a `project.json` tagged `type:*` and no manifest of any ecosystem.
 *
 * @remarks
 * `bicep-iac` is such a project: it is files written directly, with no `package.json`, so
 * `locateProjects` cannot see it. The tag is what says mnci made it, so an unrelated
 * `project.json` is left alone.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param known - The workspace-relative directories `locateProjects` already found.
 * @returns The manifest-less projects, with the ecosystem `none`.
 * @typeParam None - this function has no generic type parameters.
 */
function locateManifestlessProjects (workspaceRoot: string, known: ReadonlySet<string>): ProjectSummary[] {
  return PROJECT_PARENTS
    .flatMap(parent => childDirectories(workspaceRoot, parent).map(entry => `${parent}/${entry}`))
    .filter(dir => !known.has(dir))
    .flatMap((dir): ProjectSummary[] => {
      const projectJsonPath = join(workspaceRoot, dir, 'project.json')
      if (!fileExists(projectJsonPath)) return []
      const project = readJson<{ tags?: string[], targets?: Record<string, unknown> }>(projectJsonPath)
      const typeTag = (project.tags ?? []).find(tag => tag.startsWith(TYPE_TAG_PREFIX))
      if (typeTag === undefined) return []

      return [{ name: dir.slice(dir.lastIndexOf('/') + 1), dir, ecosystem: 'none', kind: typeTag.slice(TYPE_TAG_PREFIX.length), targets: Object.keys(project.targets ?? {}) }]
    })
}

/**
 * Names the folders directly inside a workspace-relative directory.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param parent - Workspace-relative directory.
 * @returns The folder names, or none when the directory does not exist.
 * @typeParam None - this function has no generic type parameters.
 */
function childDirectories (workspaceRoot: string, parent: string): string[] {
  try {
    return readdirSync(join(workspaceRoot, parent), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * Finds the projects of a workspace and what mnci recorded about each.
 *
 * @remarks
 * The projects come from `locateProjects` (every manifest of every ecosystem), the kind and
 * the targets from the project's own `project.json` when it has one. A project with no manifest
 * at all (`bicep-iac`) is found by its `type:*` tag and reported with the ecosystem `none`. Nothing is asked of Nx,
 * which takes seconds to start; a list for a sidebar has to be quick.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The projects, sorted by directory.
 * @throws Error when a `project.json` exists but is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function listProjects (workspaceRoot: string): ProjectSummary[] {
  const located = locateProjects(workspaceRoot)
  const manifestless = locateManifestlessProjects(workspaceRoot, new Set(located.map(location => location.dir)))

  return [...located
    .map((location): ProjectSummary => {
      const projectJsonPath = join(workspaceRoot, location.dir, 'project.json')
      const project = fileExists(projectJsonPath)
        ? readJson<{ tags?: string[], targets?: Record<string, unknown> }>(projectJsonPath)
        : {}
      const manifestPath = join(workspaceRoot, location.dir, 'package.json')
      const manifestTags = fileExists(manifestPath) ? readJson<{ nx?: { tags?: string[] } }>(manifestPath).nx?.tags ?? [] : []
      const typeTag = [...project.tags ?? [], ...manifestTags].find(tag => tag.startsWith(TYPE_TAG_PREFIX))

      return {
        name:      location.name,
        dir:       location.dir,
        ecosystem: location.ecosystem,
        kind:      typeTag?.slice(TYPE_TAG_PREFIX.length),
        targets:   Object.keys(project.targets ?? {}),
      }
    }), ...manifestless]
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
