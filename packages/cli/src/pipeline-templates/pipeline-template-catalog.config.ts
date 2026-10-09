/**
 * The CI providers a template can be written for.
 *
 * @remarks
 * The two the generated pipelines exist for; `both` is a workspace setting, resolved to these before a template is rendered.
 * @typeParam None - this type has no generic type parameters.
 */
export type TemplateProvider = 'github' | 'azure'

/**
 * One ready-made pipeline `mnci pipeline` can write.
 *
 * @remarks
 * See {@link PIPELINE_TEMPLATES}.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PipelineTemplate {
  /** The name given to `mnci pipeline`, and the file's base name. */
  name:         string
  /** What it does, in one line. */
  description:  string
  /** The providers it exists for. */
  providers:    readonly TemplateProvider[]
  /** Whether it needs `--project` (the app it builds, packs or deploys). */
  needsProject: boolean
}

/**
 * Every template, in the order `mnci pipeline` lists them.
 *
 * @remarks
 * Release (a GitHub Release with the app's files, a published package) is not here: it is the `release` phase of the
 * generated `ci.yml` / `azure-pipelines.yml`, so a second copy would publish twice.
 */
export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    name:         'e2e',
    description:  'Run the end-to-end targets (nx run-many -t e2e) on a push to main, on a pull request and on demand',
    providers:    ['github', 'azure'],
    needsProject: false,
  },
  {
    name:         'package-zip',
    description:  'Build the per-app zips (mnci ci pack) and keep dist/drop as a build artifact, the input of a classic Release pipeline',
    providers:    ['github', 'azure'],
    needsProject: false,
  },
  {
    name:         'deploy-pages',
    description:  'Build a react-app and deploy it to GitHub Pages',
    providers:    ['github'],
    needsProject: true,
  },
  {
    name:         'deploy-azure-function',
    description:  'Package a function app and deploy it to an Azure Function App',
    providers:    ['github', 'azure'],
    needsProject: true,
  },
]
