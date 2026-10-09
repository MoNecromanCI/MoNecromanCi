import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import { ACTION_VERSIONS, NODE_VERSION, NPM_VERSION, readMnciConfig, type CiProvider } from '../workspace-overlay'
import { PIPELINE_TEMPLATES, type TemplateProvider } from './pipeline-template-catalog.config'
import { renderPipelineTemplate } from './render-pipeline-template.algorithm'

/**
 * What `mnci pipeline` is given besides the template's name.
 *
 * @remarks
 * See {@link addPipelineTemplate}.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface AddPipelineTemplateOptions {
  /** The app a project template builds, packs or deploys. */
  project?: string
  /** The provider to write for; default the workspace's own. */
  ci?:      CiProvider
  /** Overwrite a file that is already there. */
  force?:   boolean
}

/** A project name that is safe to put into a pipeline file: no whitespace, quote or shell character. */
const SAFE_PROJECT = /^[\w.-]+$/

/**
 * The providers a workspace uses, when the caller did not say.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The provider recorded in `nx.json`, else what the repository already holds, else GitHub.
 * @throws Never - an unreadable `nx.json` reads as not recorded.
 * @typeParam None - this function has no generic type parameters.
 */
function workspaceProvider (workspaceRoot: string): CiProvider {
  try {
    const recorded = readMnciConfig(workspaceRoot).ci
    if (recorded !== undefined) {
      return recorded
    }
  } catch {
    // No readable nx.json: look at the files.
  }
  const azure = fileExists(join(workspaceRoot, 'azure-pipelines.yml'))
  const github = fileExists(join(workspaceRoot, '.github', 'workflows'))
  if (azure && github) {
    return 'both'
  }

  return azure ? 'azure' : 'github'
}

/**
 * Prints the templates and what each needs (`mnci pipeline`).
 *
 * @remarks
 * Also says where the two things the issue named first live: releasing an app to GitHub Releases and publishing a package are
 * the generated pipeline's own `release` phase.
 *
 * @param none - takes no parameters.
 * @returns Nothing.
 * @throws Never - only prints.
 * @typeParam None - this function has no generic type parameters.
 */
export function listPipelineTemplates (): void {
  logger.info('Templates for `mnci pipeline <name>`:')
  for (const template of PIPELINE_TEMPLATES) {
    logger.detail(`${template.name} (${template.providers.join(', ')}${template.needsProject ? '; needs --project' : ''}) - ${template.description}`)
  }
  logger.info('Releasing an app to GitHub Releases and publishing a package are already the `release` phase of the generated pipeline.')
}

/**
 * Writes a template's pipeline file(s) into the workspace (`mnci pipeline <name>`).
 *
 * @remarks
 * Written once and the team's from then on, so a file that exists is left alone unless `force` is given. A template exists for
 * some providers only; for a workspace on `both` it writes the ones it has and says which it skipped, and it fails when it has
 * none for the chosen provider.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The template's name.
 * @param options - The project, the provider and whether to overwrite.
 * @returns The workspace-relative paths written.
 * @throws Error for an unknown template, a missing or unsafe `--project`, an app that does not exist, or a provider the template has no file for.
 * @typeParam None - this function has no generic type parameters.
 */
export function addPipelineTemplate (workspaceRoot: string, name: string, options: AddPipelineTemplateOptions = {}): string[] {
  const template = PIPELINE_TEMPLATES.find(each => each.name === name)
  if (template === undefined) {
    throw new Error(`Unknown template '${name}'. Choose one of: ${PIPELINE_TEMPLATES.map(each => each.name).join(', ')}.`)
  }
  if (template.needsProject) {
    if (options.project === undefined) {
      throw new Error(`The ${name} template needs the app it works on: mnci pipeline ${name} --project <app>.`)
    }
    if (!SAFE_PROJECT.test(options.project) || !fileExists(join(workspaceRoot, 'apps', options.project))) {
      throw new Error(`There is no app named '${options.project}' under apps/.`)
    }
  }

  const chosen = options.ci ?? workspaceProvider(workspaceRoot)
  const wanted: TemplateProvider[] = chosen === 'both' ? ['github', 'azure'] : [chosen]
  const applicable = wanted.filter(provider => template.providers.includes(provider))
  if (applicable.length === 0) {
    throw new Error(`The ${name} template exists for ${template.providers.join(' and ')} only, and this workspace uses ${chosen}.`)
  }
  const skipped = wanted.filter(provider => !applicable.includes(provider))
  for (const provider of skipped) {
    logger.warn(`The ${name} template has no ${provider} version, so none was written for it.`)
  }

  const written: string[] = []
  for (const provider of applicable) {
    const rendered = renderPipelineTemplate(name, provider, {
      nodeVersion: NODE_VERSION,
      npmVersion:  NPM_VERSION,
      actions:     ACTION_VERSIONS,
      project:     options.project ?? '<project>',
    })
    if (rendered === undefined) {
      continue
    }
    if (fileExists(join(workspaceRoot, rendered.path)) && options.force !== true) {
      logger.warn(`${rendered.path} already exists and was left as it is (--force overwrites it).`)
      continue
    }
    writeFileEnsured(join(workspaceRoot, rendered.path), rendered.content)
    logger.detail(`wrote ${rendered.path}`)
    written.push(rendered.path)
  }

  return written
}
