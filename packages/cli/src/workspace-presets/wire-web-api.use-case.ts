import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { apiBarrel, apiHandler, apiHandlerSpec, webAppSpec, webGreetingBarrel, webGreetingClient, webGreetingClientSpec, webGreetingComponent, webGreetingSpec, withApiProxy } from './web-api-wiring.algorithm'

/** The port the Express sample listens on, which the frontend's dev server forwards `/api` to. */
const API_ORIGIN = 'http://localhost:3000'

/**
 * Names of the projects of a `web-api` preset.
 *
 * @remarks
 * Fixed by the preset's catalog entry; passed in so the wiring does not restate them.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface WebApiProjects {
  /** The shared library's directory name under `libs/`. */
  shared: string
  /** The API's directory name under `apps/`. */
  api:    string
  /** The frontend's directory name under `apps/`. */
  web:    string
}

/**
 * Adds a dependency to a project's manifest, keeping everything else in it.
 *
 * @param manifestPath - Absolute path to the project's `package.json`.
 * @param name - The package to depend on.
 * @returns Nothing.
 * @throws Error when the manifest is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function declareDependency (manifestPath: string, name: string): void {
  const manifest = readJson<{ dependencies?: Record<string, string> } & Record<string, unknown>>(manifestPath)
  writeFileEnsured(manifestPath, toJson({ ...manifest, dependencies: { ...manifest.dependencies, [name]: '*' } }))
}

/**
 * Removes the files a sample slice had that the shared library now owns.
 *
 * @param slice - Absolute path to the slice's directory.
 * @param files - The file names to remove.
 * @returns Nothing.
 * @throws Never - a missing file is already gone.
 * @typeParam None - this function has no generic type parameters.
 */
function removeFiles (slice: string, files: readonly string[]): void {
  for (const file of files) {
    rmSync(join(slice, file), { force: true })
  }
}

/**
 * Replaces one exact piece of text in a generated file, and fails when it is not there.
 *
 * @remarks
 * The preset edits files `mnci add` generated. If a generator changes and the text moves, a silent no-op would
 * leave a workspace that looks wired and is not, so a missing anchor is an error naming the file.
 *
 * @param path - Absolute path to the file.
 * @param anchor - The text to replace.
 * @param replacement - What to put there.
 * @returns Nothing.
 * @throws Error when the anchor is not in the file.
 * @typeParam None - this function has no generic type parameters.
 */
function replaceOnce (path: string, anchor: string, replacement: string): void {
  const text = readFileSync(path, 'utf8')
  if (!text.includes(anchor)) {
    throw new Error(`${path} has no ${anchor}; the generator's output changed, so the preset cannot wire it.`)
  }
  writeFileEnsured(path, text.replace(anchor, () => replacement))
}

/**
 * Forwards `/api` from the frontend's dev server to the API.
 *
 * @param viteConfigPath - Absolute path to the frontend's `vite.config.mts`.
 * @returns Nothing.
 * @throws Error when the config has no server block to add the proxy to.
 * @typeParam None - this function has no generic type parameters.
 */
function proxyApi (viteConfigPath: string): void {
  const text = readFileSync(viteConfigPath, 'utf8')
  const proxied = withApiProxy(text, API_ORIGIN)
  if (proxied === text && !text.includes('proxy:')) {
    throw new Error(`${viteConfigPath} has no server block to add the /api proxy to; the generator's output changed, so the preset cannot wire it.`)
  }
  writeFileEnsured(viteConfigPath, proxied)
}

/**
 * Wires a generated frontend, API and shared library into one working shape.
 *
 * @remarks
 * Edits what `mnci add` generated, with nothing added that `add` would not recognise afterwards:
 *
 * - **The API** answers `GET /api/greeting` with the shared library's `greet`, reached by its package name and
 *   declared as a dependency, and drops its own copy of the use case and contract.
 * - **The frontend** asks `/api/greeting` and types the answer with the shared `Greeting`, and drops its copy
 *   too. Its Vite dev server forwards `/api` to the API, so the browser sees one origin.
 * - **Specs** for both halves follow, with `fetch` answering as the API would.
 *
 * It does not install or sync: the caller does that once, after the manifests have changed.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projects - The names of the three projects.
 * @returns Nothing.
 * @throws Error when a project the preset added is not where `add` puts it.
 * @typeParam None - this function has no generic type parameters.
 */
export function wireWebApi (workspaceRoot: string, projects: WebApiProjects): void {
  const sharedManifest = join(workspaceRoot, 'libs', projects.shared, 'package.json')
  if (!fileExists(sharedManifest)) {
    throw new Error(`The shared library was not added at libs/${projects.shared}, so there is nothing to wire the API and the frontend to.`)
  }
  const shared = readJson<{ name: string }>(sharedManifest).name

  const api = join(workspaceRoot, 'apps', projects.api)
  declareDependency(join(api, 'package.json'), shared)
  const hello = join(api, 'src', 'hello')
  writeFileEnsured(join(hello, 'hello.handler.ts'), apiHandler(shared))
  writeFileEnsured(join(hello, 'hello.handler.spec.ts'), apiHandlerSpec(shared))
  writeFileEnsured(join(hello, 'index.ts'), apiBarrel())
  removeFiles(hello, ['greet.use-case.ts', 'greet.use-case.spec.ts', 'greeting.contract.ts'])
  replaceOnce(join(api, 'src', 'main.ts'), "app.get('/', helloHandler)", "app.get('/api/greeting', helloHandler)")

  const web = join(workspaceRoot, 'apps', projects.web)
  declareDependency(join(web, 'package.json'), shared)
  const greeting = join(web, 'src', 'greeting')
  writeFileEnsured(join(greeting, 'greeting.client.ts'), webGreetingClient(shared))
  writeFileEnsured(join(greeting, 'greeting.client.spec.ts'), webGreetingClientSpec())
  writeFileEnsured(join(greeting, 'greeting.component.tsx'), webGreetingComponent(shared))
  writeFileEnsured(join(greeting, 'greeting.component.spec.tsx'), webGreetingSpec())
  writeFileEnsured(join(greeting, 'index.ts'), webGreetingBarrel())
  removeFiles(greeting, ['greet.use-case.ts', 'greet.use-case.spec.ts', 'greeting.contract.ts'])
  writeFileEnsured(join(web, 'src', 'app', 'app.component.spec.tsx'), webAppSpec())
  proxyApi(join(web, 'vite.config.mts'))
}
