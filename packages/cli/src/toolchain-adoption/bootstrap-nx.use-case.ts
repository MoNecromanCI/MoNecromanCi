import { join } from 'node:path'
import { fileExists, readJson } from '../file-system'

/** The plugin every adopted repository gets: TypeScript project references, `typecheck` and `build` inference. */
const BASE_PLUGIN = '@nx/js'

/** A tool a repository may already use, and the Nx plugin that infers its targets. */
const TOOL_PLUGINS: readonly (readonly [tool: string, plugin: string])[] = [
  ['eslint', '@nx/eslint'],
  ['jest', '@nx/jest'],
  ['vitest', '@nx/vite'],
]

/**
 * What {@link bootstrapNx} needs from its environment, so a test can run it without npm or a network.
 *
 * @remarks
 * Every member has a real default in the caller.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface BootstrapDependencies {
  /** Runs a command with its output shown; returns the exit status. */
  run: (command: string, arguments_: string[], cwd: string) => number
}

/**
 * What {@link bootstrapNx} did.
 *
 * @remarks
 * `plugins` is empty when the repository already had an `nx.json` and nothing was done.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface BootstrapResult {
  /** Whether Nx was set up by this call. */
  bootstrapped: boolean
  /** The plugins added, in order. */
  plugins:      string[]
}

/**
 * The plugins a repository's own tooling calls for.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @returns `@nx/js`, then a plugin for each of ESLint, Jest and Vitest the root manifest declares.
 * @throws Error when the root `package.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function pluginsFor (repositoryRoot: string): string[] {
  const manifestPath = join(repositoryRoot, 'package.json')
  const manifest = fileExists(manifestPath)
    ? readJson<{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }>(manifestPath)
    : {}
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })

  return [BASE_PLUGIN, ...TOOL_PLUGINS.filter(([tool]) => declared.includes(tool)).map(([, plugin]) => plugin)]
}

/**
 * Sets Nx up in a repository that has none, through Nx's own commands.
 *
 * @remarks
 * Delegates, as the rest of mnci does: `nx init` writes `nx.json` and installs `nx`, and `nx add` registers a plugin
 * for each tool the repository already uses, so its projects get their targets inferred. `--plugins=skip` leaves
 * the choice of plugins to this function, because Nx's own default (`--plugins=all`) names every target
 * `<tool>:<target>`. Where a package has its own `lint` or `test` script Nx still namespaces the inferred target
 * (`eslint:lint`), so the script keeps working under its own name. A repository that already has an `nx.json` is
 * left alone: this is for the first step onto Nx, not a second one.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param nxVersion - The Nx version to install, or `latest`.
 * @param dependencies - How to run a command.
 * @returns Whether Nx was set up, and the plugins added.
 * @throws Error when `nx init` or `nx add` fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function bootstrapNx (repositoryRoot: string, nxVersion: string | undefined, dependencies: BootstrapDependencies): BootstrapResult {
  if (fileExists(join(repositoryRoot, 'nx.json'))) {
    return { bootstrapped: false, plugins: [] }
  }
  const initialised = dependencies.run('npx', ['--yes', `nx@${nxVersion ?? 'latest'}`, 'init', '--interactive=false', '--nxCloud=skip', '--plugins=skip'], repositoryRoot)
  if (initialised !== 0) {
    throw new Error('`nx init` failed, so Nx could not be set up here. Read its output above; nothing else was changed after it.')
  }
  const plugins = pluginsFor(repositoryRoot)
  for (const plugin of plugins) {
    if (dependencies.run('npx', ['nx', 'add', plugin], repositoryRoot) !== 0) {
      throw new Error(`\`nx add ${plugin}\` failed. Nx itself is set up (nx.json exists); add the plugin by hand once its error is dealt with.`)
    }
  }

  return { bootstrapped: true, plugins }
}
