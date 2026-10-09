import yaml from 'js-yaml'
import { PIPELINE_TEMPLATES } from './pipeline-template-catalog.config'
import { renderPipelineTemplate, type TemplateSettings } from './render-pipeline-template.algorithm'

const settings: TemplateSettings = {
  nodeVersion: '24',
  npmVersion:  '12',
  actions:     { 'actions/checkout': 'v7', 'actions/setup-node': 'v7', 'actions/upload-artifact': 'v7', 'azure/login': 'v3' },
  project:     'site',
}

const everyFile = PIPELINE_TEMPLATES.flatMap(template => template.providers.map(provider => ({ name: template.name, provider })))

describe('renderPipelineTemplate', () => {
  it.each(everyFile)('writes $name for $provider as a YAML document', ({ name, provider }) => {
    const rendered = renderPipelineTemplate(name, provider, settings)

    expect(rendered).toBeDefined()
    expect(() => yaml.load(rendered?.content ?? '')).not.toThrow()
    expect(rendered?.path).toBe(provider === 'github' ? `.github/workflows/${name}.yml` : `azure-pipelines/${name}.yml`)
  })

  it('has no file for a provider a template does not support', () => {
    expect(renderPipelineTemplate('deploy-pages', 'azure', settings)).toBeUndefined()
    expect(renderPipelineTemplate('nonsense', 'github', settings)).toBeUndefined()
  })

  it('pins Node, npm and the actions the generated pipeline pins', () => {
    const rendered = renderPipelineTemplate('e2e', 'github', settings)?.content ?? ''

    expect(rendered).toContain('node-version: 24')
    expect(rendered).toContain('npm install -g npm@12')
    expect(rendered).toContain('actions/checkout@v7')
  })

  it('builds the named app in the pages template and deploys what it built', () => {
    const document = yaml.load(renderPipelineTemplate('deploy-pages', 'github', settings)?.content ?? '') as {
      jobs: { deploy: { steps: Array<{ run?: string, with?: { path?: string } }> } }
    }
    const steps = document.jobs.deploy.steps

    expect(steps.some(step => step.run?.startsWith('npx nx run site:build-prod'))).toBe(true)
    expect(steps.some(step => step.with?.path === 'apps/site/dist-prod')).toBe(true)
  })

  it('finds the app zip by its name in the function deploy, for both providers', () => {
    expect(renderPipelineTemplate('deploy-azure-function', 'github', settings)?.content).toContain('dist/drop/*-site.zip')
    expect(renderPipelineTemplate('deploy-azure-function', 'azure', settings)?.content).toContain('dist/drop/*-site.zip')
  })
})
