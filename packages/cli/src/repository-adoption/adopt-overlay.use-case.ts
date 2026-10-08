import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson } from '../file-system'
import { runCapture } from '../nx-workspace'
import { runUpgrade, type UpgradeOptions } from '../workspace-upgrade'
import { readMnciConfig, type CiProvider } from '../workspace-overlay'
import { requireCleanWorkingTree } from './clean-working-tree.validator'

/**
 * What {@link adoptOverlay} needs from its environment, so a test can run it without Nx or npm.
 *
 * @remarks
 * Every member has a real default.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface OverlayDependencies {
  /** Applies the overlay: the same function `mnci upgrade` runs. */
  upgrade: (repositoryRoot: string, options: UpgradeOptions) => void
  /** Runs a command and returns what it printed. */
  capture: (command: string, arguments_: string[], cwd: string) => { status: number, stdout: string }
}

/**
 * Which CI provider the repository already uses, read from the pipeline files it has.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @returns `azure`, `github` or `both`; `undefined` when it has no pipeline file.
 * @throws Never - a missing directory is no pipeline.
 * @typeParam None - this function has no generic type parameters.
 */
function detectCiProvider (repositoryRoot: string): CiProvider | undefined {
  const azure = existsSync(join(repositoryRoot, 'azure-pipelines.yml'))
  const workflows = join(repositoryRoot, '.github', 'workflows')
  const github = existsSync(workflows) && readdirSync(workflows).some(file => /\.ya?ml$/.test(file))
  if (azure && github) {
    return 'both'
  }
  if (azure) {
    return 'azure'
  }

  return github ? 'github' : undefined
}

/**
 * Which unit-test runner the root manifest declares.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @returns `jest` or `vitest`; `undefined` when neither is declared.
 * @throws Error when the root `package.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function detectTestRunner (repositoryRoot: string): 'jest' | 'vitest' | undefined {
  const manifestPath = join(repositoryRoot, 'package.json')
  if (!fileExists(manifestPath)) {
    return undefined
  }
  const manifest = readJson<{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }>(manifestPath)
  const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
  if (declared.has('vitest')) {
    return 'vitest'
  }

  return declared.has('jest') ? 'jest' : undefined
}

/**
 * Applies the mnci overlay to an existing Nx repository: release config, pipeline, npmrc, commitlint, scripts.
 *
 * @remarks
 * This is `mnci upgrade` behind the guard rails adoption needs. It refuses an unclean git tree, needs an
 * `nx.json` (adopt does not install Nx), and fills the CI provider and the test runner from what the
 * repository already has when neither a flag nor a previous `mnci` block names them. The pipeline is merged
 * by the same legacy migration `upgrade` uses: steps mnci does not recognise go into the three slots, the
 * ones it does are replaced by `mnci ci <phase>`. Everything else (scope, registry, agent) has no safe
 * guess and is reported by `upgrade` as the flag to pass.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param options - The same flags `mnci upgrade` takes.
 * @param dependencies - The upgrade and the process runner; real ones by default.
 * @returns Nothing.
 * @throws Error when the tree is not clean, there is no `nx.json`, or a required option is missing.
 * @typeParam None - this function has no generic type parameters.
 */
export function adoptOverlay (repositoryRoot: string, options: UpgradeOptions, dependencies: Partial<OverlayDependencies> = {}): void {
  requireCleanWorkingTree(repositoryRoot, dependencies.capture ?? runCapture)
  if (!fileExists(join(repositoryRoot, 'nx.json'))) {
    throw new Error('There is no nx.json, so Nx is not set up here. Set it up first (`npx nx@latest init`); adopt does not install Nx yet.')
  }
  const persisted = readMnciConfig(repositoryRoot)
  const filled: UpgradeOptions = {
    ...options,
    ci:         options.ci ?? (persisted.ci === undefined ? detectCiProvider(repositoryRoot) : undefined),
    testRunner: options.testRunner ?? (persisted.stack?.testRunner === undefined ? detectTestRunner(repositoryRoot) : undefined),
  }
  ;(dependencies.upgrade ?? runUpgrade)(repositoryRoot, filled)
}
