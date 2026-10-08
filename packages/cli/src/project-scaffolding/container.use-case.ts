import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { CONTAINER_TARGETS, planContainer, type ContainerPlan, type ContainerTarget } from './container-image.algorithm'
import { registerProjectCommands } from './post-generation.use-case'

/**
 * The tag that marks a container project, in its manifest's `nx.tags`.
 *
 * @remarks
 * The same `type:<kind>` form `mnci adopt --kinds` records and `mnci projects` reads.
 */
export const CONTAINER_TAG = 'type:container'

/**
 * Where the helper script lives in a workspace that has a container project.
 *
 * @remarks
 * A workspace file mnci owns, like the VS Code extension's.
 */
export const CONTAINER_SCRIPT_PATH = 'tools/container-image.cjs'

/**
 * The helper script a container project's targets run.
 *
 * @remarks
 * Written into the workspace, like the VS Code extension's, and rewritten by `mnci upgrade`. One place for the
 * parts a shell one-liner cannot do the same everywhere: the image tag comes from `VERSION` (`dev` when it is
 * unset, as the Go builds do) and `latest` is moved too, the extra build context is passed only when its directory
 * exists, and a missing Docker is reported by name rather than as a spawn failure.
 */
export const CONTAINER_SCRIPT = `// Written by MoNecromanCI; \`mnci upgrade\` rewrites it. Builds and runs a container image.
//   node tools/container-image.cjs build --image <name> --file <Dockerfile> --context <dir> [--files <dir>]
//   node tools/container-image.cjs start --image <name> [--publish <host:container>]
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')

const [command, ...rest] = process.argv.slice(2)
const options = {}
for (let index = 0; index < rest.length; index += 2) {
  options[rest[index].replace(/^--/, '')] = rest[index + 1]
}
const version = process.env.VERSION || 'dev'

/** Runs docker with the output shown, and exits with its status. */
function docker (args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' })
  if (result.error) {
    console.error('Docker is not available: ' + result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (command === 'build') {
  const args = ['build', '-f', options.file, '-t', options.image + ':' + version, '-t', options.image + ':latest']
  if (options.files && existsSync(options.files)) {
    args.push('--build-context', 'files=' + options.files)
  }
  args.push(options.context)
  docker(args)
} else if (command === 'start') {
  const args = ['run', '--rm', '--init']
  if (options.publish) {
    args.push('-p', options.publish)
  }
  args.push(options.image + ':latest')
  docker(args)
} else {
  console.error('usage: container-image.cjs build|start --image <name> ...')
  process.exit(2)
}
`

/**
 * What {@link addContainer} was asked for.
 *
 * @remarks
 * `app` is the project to put in an image, by directory name; `port` is the port it listens on.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ContainerOptions {
  /** The app to containerise. */
  app:   string
  /** The port the app listens on. */
  port?: number
}

/**
 * Works out which kind of app a directory holds.
 *
 * @param appRoot - Absolute path to the app.
 * @returns The kind, or `undefined` when it is not one an image is built for.
 * @throws Error when the app's manifest is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function detectTarget (appRoot: string): ContainerTarget | undefined {
  if (fileExists(join(appRoot, 'go.mod'))) {
    return fileExists(join(appRoot, 'host.json')) ? undefined : 'go-app'
  }
  const manifestPath = join(appRoot, 'package.json')
  if (!fileExists(manifestPath) || fileExists(join(appRoot, 'host.json'))) {
    return undefined
  }
  const manifest = readJson<{ dependencies?: Record<string, string>, devDependencies?: Record<string, string>, nx?: { targets?: Record<string, { executor?: string }> } }>(manifestPath)
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  if (declared.includes('react') && fileExists(join(appRoot, 'index.html'))) {
    return 'react-app'
  }

  return manifest.nx?.targets?.build?.executor === '@nx/esbuild:esbuild' ? 'node-app' : undefined
}

/**
 * The targets of a container project.
 *
 * @param name - The container project's directory name.
 * @param appProject - The app's Nx project name.
 * @param plan - The image plan.
 * @returns The `nx.targets` entry for its manifest.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function containerTargets (name: string, appProject: string, plan: ContainerPlan): Record<string, unknown> {
  const build = [
    'node', CONTAINER_SCRIPT_PATH, 'build',
    '--image', name,
    '--file', `apps/${name}/Dockerfile`,
    '--context', plan.contextDirectory,
    '--files', `apps/${name}/files`,
  ].join(' ')
  const start = ['node', CONTAINER_SCRIPT_PATH, 'start', '--image', name, ...plan.publish === undefined ? [] : ['--publish', plan.publish]].join(' ')

  return {
    // Not called `build`: CI runs every project's `build`, and building an image needs a Docker engine that
    // an agent may not have (a Windows agent cannot run Linux images at all).
    image: { executor: 'nx:run-commands', cache: false, dependsOn: [`${appProject}:${plan.dependsOn}`], options: { command: build } },
    start: { executor: 'nx:run-commands', continuous: true, dependsOn: ['image'], options: { command: start } },
  }
}

/**
 * Adds a container project that builds an existing app into an image.
 *
 * @remarks
 * A project beside the app (`apps/<name>`) holding its `Dockerfile`, a `Dockerfile.dockerignore`, the files the
 * image copies from the build context's side (`files/`), and two targets: `image`, which builds `<name>:<VERSION>`
 * and `<name>:latest` after the app's own output target, and `start`, which runs it. It depends on the app
 * through Nx, so `affected` knows an app change affects its image. The target is called `image` and not
 * `build` on purpose, so CI's verify does not need Docker. Supports Node apps, React apps and Go apps; the
 * Docker engine is needed to run `image`, not to add the project.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The container project's name.
 * @param options - The app and the port.
 * @returns Nothing.
 * @throws Error when the app does not exist or is not a kind an image is built for.
 * @typeParam None - this function has no generic type parameters.
 */
export function addContainer (workspaceRoot: string, name: string, options: ContainerOptions): void {
  const appRoot = join(workspaceRoot, 'apps', options.app)
  if (!fileExists(appRoot)) {
    throw new Error(`--app ${options.app}: there is no apps/${options.app} to put in an image. Add the app first.`)
  }
  const target = detectTarget(appRoot)
  if (target === undefined) {
    throw new Error(`--app ${options.app}: apps/${options.app} is not an app an image is built for (${CONTAINER_TARGETS.join(', ')}). An Azure Functions app has its own host image and is not supported yet.`)
  }
  const plan = planContainer(target, options.app, options.port)
  const appManifestPath = join(appRoot, 'package.json')
  const appProject = fileExists(appManifestPath) ? readJson<{ name: string }>(appManifestPath).name : options.app
  const scope = appProject.startsWith('@') ? `${appProject.split('/', 1)[0]}/` : ''

  const projectRoot = join(workspaceRoot, 'apps', name)
  writeFileEnsured(join(projectRoot, 'Dockerfile'), plan.dockerfile)
  writeFileEnsured(join(projectRoot, 'Dockerfile.dockerignore'), plan.dockerignore)
  for (const [file, text] of Object.entries(plan.files)) {
    writeFileEnsured(join(projectRoot, 'files', file), text)
  }
  writeFileEnsured(join(workspaceRoot, CONTAINER_SCRIPT_PATH), CONTAINER_SCRIPT)
  writeFileEnsured(join(projectRoot, 'package.json'), toJson({
    name:    `${scope}${name}`,
    version: '0.0.1',
    private: true,
    nx:      { tags: [CONTAINER_TAG], implicitDependencies: [appProject], targets: containerTargets(name, appProject, plan) },
  }))
  registerProjectCommands(workspaceRoot, name, {
    build: false,
    start: `nx run ${name}:start`,
    qa:    `nx run ${name}:image`,
    extra: { image: `nx run ${name}:image` },
  })
}

/**
 * Rewrites the helper script in a workspace that has a container project and an out-of-date copy.
 *
 * @remarks
 * Run by `mnci upgrade`, so a fix to the script reaches workspaces that already have one. A workspace with no
 * container project is left without it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Whether the script was written.
 * @throws Propagates any `fs` error writing the file.
 * @typeParam None - this function has no generic type parameters.
 */
export function refreshContainerScript (workspaceRoot: string): boolean {
  let entries: string[]
  try {
    entries = readdirSync(join(workspaceRoot, 'apps'))
  } catch {
    return false
  }
  const hasContainer = entries.some(entry => {
    const manifestPath = join(workspaceRoot, 'apps', entry, 'package.json')

    return fileExists(manifestPath) && (readJson<{ nx?: { tags?: string[] } }>(manifestPath).nx?.tags ?? []).includes(CONTAINER_TAG)
  })
  const path = join(workspaceRoot, CONTAINER_SCRIPT_PATH)
  if (!hasContainer || (fileExists(path) && readFileSync(path, 'utf8') === CONTAINER_SCRIPT)) {
    return false
  }
  writeFileEnsured(path, CONTAINER_SCRIPT)

  return true
}
