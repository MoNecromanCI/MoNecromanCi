/**
 * Ready-made pipeline files a workspace can add after it was generated (`mnci pipeline`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { addPipelineTemplate, listPipelineTemplates, type AddPipelineTemplateOptions } from './add-pipeline-template.use-case'
export { PIPELINE_TEMPLATES, type PipelineTemplate, type TemplateProvider } from './pipeline-template-catalog.config'
