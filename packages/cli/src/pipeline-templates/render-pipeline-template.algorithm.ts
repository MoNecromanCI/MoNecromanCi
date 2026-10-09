import type { TemplateProvider } from './pipeline-template-catalog.config'

/**
 * The actions a template uses beyond the ones the generated pipeline already pins.
 *
 * @remarks
 * The ones the pipeline pins (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `azure/login`) come in through
 * {@link TemplateSettings.actions}, so they move together.
 */
export const TEMPLATE_ACTION_VERSIONS = {
  'actions/configure-pages':       'v5',
  'actions/upload-pages-artifact': 'v3',
  'actions/deploy-pages':          'v4',
  'azure/functions-action':        'v1',
} as const

/**
 * What a template is rendered from.
 *
 * @remarks
 * See {@link renderPipelineTemplate}.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface TemplateSettings {
  /** The Node major the workspace is built with. */
  nodeVersion: string
  /** The npm major the workspace is built with. */
  npmVersion:  string
  /** The pinned majors of the actions the generated pipeline uses. */
  actions:     Readonly<Record<string, string>>
  /** The app a project template builds, packs or deploys; a placeholder for a template that has none. */
  project:     string
}

/**
 * A rendered file: where it goes and what it holds.
 *
 * @remarks
 * See {@link renderPipelineTemplate}.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RenderedTemplate {
  /** Workspace-relative path. */
  path:    string
  /** The file's text. */
  content: string
}

/** The steps every GitHub job of a template starts with: the checkout, Node and the install. */
function githubSetup (settings: TemplateSettings): string {
  return `      - uses: actions/checkout@${settings.actions['actions/checkout']}
        with:
          fetch-depth: 0

      - uses: actions/setup-node@${settings.actions['actions/setup-node']}
        with:
          node-version: ${settings.nodeVersion}
          cache: npm

      - run: npm install -g npm@${settings.npmVersion}
        name: Pin npm to the major mnci verifies against

      # A feed that needs credentials to install needs the same step the generated ci.yml has before this.
      - run: npm ci
        name: Install dependencies
`
}

/** The steps every Azure job of a template starts with: Node and the install. */
function azureSetup (settings: TemplateSettings): string {
  return `  - task: UseNode@1
    inputs:
      version: ${settings.nodeVersion}.x

  - script: npm install -g npm@${settings.npmVersion}
    displayName: Pin npm to the major mnci verifies against

  # A feed that needs credentials to install needs the same step the generated azure-pipelines.yml has before this.
  - script: npm ci
    displayName: Install dependencies
`
}

/** A GitHub workflow file. */
function githubFile (name: string, content: string): RenderedTemplate {
  return { path: `.github/workflows/${name}.yml`, content }
}

/** An Azure Pipelines file, registered as a pipeline of its own. */
function azureFile (name: string, content: string): RenderedTemplate {
  return { path: `azure-pipelines/${name}.yml`, content }
}

const AZURE_POOL = `pool:
  vmImage: ubuntu-latest
`

/**
 * Renders a template for a provider.
 *
 * @remarks
 * The files are written once and are the team's from then on: `mnci upgrade` never rewrites them. A project template without a
 * `project` renders with a placeholder the caller is expected to have refused first.
 *
 * @param name - The template's name.
 * @param provider - The CI provider the file is for.
 * @param settings - The versions to pin and the project.
 * @returns The path and text of the file, or `undefined` when the template does not exist for the provider.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function renderPipelineTemplate (name: string, provider: TemplateProvider, settings: TemplateSettings): RenderedTemplate | undefined {
  if (name === 'e2e' && provider === 'github') {
    return githubFile(name, `name: E2E

# Written by 'mnci pipeline e2e'. Yours from here: mnci upgrade does not rewrite it.
# Runs every project's e2e target. A project's e2e target is not part of CI verify, because it needs a browser or a
# toolchain the verify job does not install: add that here (for Playwright, 'npx playwright install --with-deps').

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
${githubSetup(settings)}
      - run: npx nx run-many -t e2e
        name: End-to-end tests
`)
  }
  if (name === 'e2e' && provider === 'azure') {
    return azureFile(name, `# Written by 'mnci pipeline e2e'. Yours from here: mnci upgrade does not rewrite it.
# Register it as its own pipeline (Pipelines -> New pipeline -> Existing YAML file).
# Runs every project's e2e target. A project's e2e target is not part of CI verify, because it needs a browser or a
# toolchain the verify job does not install: add that here (for Playwright, 'npx playwright install --with-deps').

trigger:
  branches:
    include:
      - main
pr: none

${AZURE_POOL}
steps:
  - checkout: self
    fetchDepth: 0

${azureSetup(settings)}
  - script: npx nx run-many -t e2e
    displayName: End-to-end tests
`)
  }
  if (name === 'package-zip' && provider === 'github') {
    return githubFile(name, `name: Package

# Written by 'mnci pipeline package-zip'. Yours from here: mnci upgrade does not rewrite it.
# Builds the zip each app's 'package' target writes into dist/drop and keeps them as a build artifact.

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  package:
    runs-on: ubuntu-latest
    steps:
${githubSetup(settings)}
      - run: npx mnci ci pack
        name: Pack the apps

      - uses: actions/upload-artifact@${settings.actions['actions/upload-artifact']}
        with:
          name: drop
          path: dist/drop
          if-no-files-found: error
`)
  }
  if (name === 'package-zip' && provider === 'azure') {
    return azureFile(name, `# Written by 'mnci pipeline package-zip'. Yours from here: mnci upgrade does not rewrite it.
# Register it as its own pipeline. The 'drop' artifact is what a classic Release pipeline takes its zips from.

trigger:
  branches:
    include:
      - main
pr: none

${AZURE_POOL}
steps:
  - checkout: self
    fetchDepth: 0

${azureSetup(settings)}
  - script: npx mnci ci pack
    displayName: Pack the apps

  - task: PublishBuildArtifacts@1
    displayName: Publish dist/drop as the drop artifact
    inputs:
      PathtoPublish: dist/drop
      ArtifactName: drop
`)
  }
  if (name === 'deploy-pages' && provider === 'github') {
    return githubFile(name, `name: Deploy to GitHub Pages

# Written by 'mnci pipeline deploy-pages --project ${settings.project}'. Yours from here: mnci upgrade does not rewrite it.
# Needs Settings -> Pages -> Source set to "GitHub Actions". The app is built with its production mode
# (build-prod, apps/${settings.project}/dist-prod) and a base path of the repository name, which is where a project site is served.

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
${githubSetup(settings)}
      - uses: actions/configure-pages@${TEMPLATE_ACTION_VERSIONS['actions/configure-pages']}

      - run: npx nx run ${settings.project}:build-prod -- --base=/\${{ github.event.repository.name }}/
        name: Build ${settings.project}

      - uses: actions/upload-pages-artifact@${TEMPLATE_ACTION_VERSIONS['actions/upload-pages-artifact']}
        with:
          path: apps/${settings.project}/dist-prod

      - uses: actions/deploy-pages@${TEMPLATE_ACTION_VERSIONS['actions/deploy-pages']}
        id: deployment
`)
  }
  if (name === 'deploy-azure-function' && provider === 'github') {
    return githubFile(name, `name: Deploy ${settings.project} to Azure

# Written by 'mnci pipeline deploy-azure-function --project ${settings.project}'. Yours from here: mnci upgrade does not rewrite it.
# Signs in with OIDC (no stored secret): the repository variables AZURE_CLIENT_ID, AZURE_TENANT_ID and AZURE_SUBSCRIPTION_ID
# name an Entra app whose federated credential trusts this repository's main branch, and AZURE_FUNCTIONAPP_NAME names the
# Function App. Deploys the zip the app's own 'package' target writes into dist/drop.

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
${githubSetup(settings)}
      - run: npx nx run ${settings.project}:package
        name: Package ${settings.project}

      - id: zip
        run: echo "path=$(ls dist/drop/*-${settings.project}.zip)" >> "$GITHUB_OUTPUT"
        name: Find the zip

      - uses: azure/login@${settings.actions['azure/login']}
        with:
          client-id: \${{ vars.AZURE_CLIENT_ID }}
          tenant-id: \${{ vars.AZURE_TENANT_ID }}
          subscription-id: \${{ vars.AZURE_SUBSCRIPTION_ID }}

      - uses: azure/functions-action@${TEMPLATE_ACTION_VERSIONS['azure/functions-action']}
        with:
          app-name: \${{ vars.AZURE_FUNCTIONAPP_NAME }}
          package: \${{ steps.zip.outputs.path }}
`)
  }
  if (name === 'deploy-azure-function' && provider === 'azure') {
    return azureFile(name, `# Written by 'mnci pipeline deploy-azure-function --project ${settings.project}'. Yours from here: mnci upgrade does not rewrite it.
# Register it as its own pipeline. Set two pipeline variables: AZURE_SERVICE_CONNECTION (the name of an Azure Resource Manager
# service connection) and AZURE_FUNCTIONAPP_NAME (the Function App). Deploys the zip the app's own 'package' target writes
# into dist/drop.

trigger:
  branches:
    include:
      - main
pr: none

${AZURE_POOL}
steps:
  - checkout: self
    fetchDepth: 0

${azureSetup(settings)}
  - script: npx nx run ${settings.project}:package
    displayName: Package ${settings.project}

  - task: AzureFunctionApp@2
    displayName: Deploy ${settings.project}
    inputs:
      connectedServiceNameARM: $(AZURE_SERVICE_CONNECTION)
      appName: $(AZURE_FUNCTIONAPP_NAME)
      package: $(Build.SourcesDirectory)/dist/drop/*-${settings.project}.zip
`)
  }

  return undefined
}
