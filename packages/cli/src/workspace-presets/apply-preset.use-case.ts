import { syncProjectReferences } from '../dependency-management'
import { runFormatter, runShell } from '../nx-workspace'
import { runAdd, type AddOptions, type ProjectKind } from '../project-scaffolding'
import { logger } from '../terminal'
import { PRESET_IDS, PRESETS, type Preset } from './preset-catalog.config'
import { wireWebApi } from './wire-web-api.use-case'

/**
 * What {@link applyPreset} needs from its environment, so a test can run it without Nx or npm.
 *
 * @remarks
 * Every member has a real default.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PresetDependencies {
  /** Adds one project, as `mnci add` does, in the current directory. */
  add:     (kind: ProjectKind, name: string, options: AddOptions) => Promise<void>
  /** Installs, so the new workspace dependencies are linked; returns the exit status. */
  install: (workspaceRoot: string) => number
  /** Regenerates the TypeScript project references. */
  sync:    (workspaceRoot: string) => void
  /** Formats what the wiring wrote. */
  format:  (workspaceRoot: string) => void
}

/**
 * Finds a preset by name, or fails with the names that exist.
 *
 * @remarks
 * Used first thing by `mnci new`, so a misspelt preset is refused before the workspace is generated.
 *
 * @param id - What was given to `--preset`.
 * @returns The preset.
 * @throws Error when no preset has that name.
 * @typeParam None - this function has no generic type parameters.
 */
export function findPreset (id: string): Preset {
  const preset = PRESETS.find(candidate => candidate.id === id)
  if (preset === undefined) {
    throw new Error(`Unknown preset '${id}'. Presets: ${PRESET_IDS.join(', ')}.`)
  }

  return preset
}

/**
 * The name of the project of a kind in a preset.
 *
 * @param preset - The preset.
 * @param kind - The kind to find.
 * @returns Its name.
 * @throws Error when the preset has no project of that kind.
 * @typeParam None - this function has no generic type parameters.
 */
function nameOf (preset: Preset, kind: ProjectKind): string {
  const project = preset.projects.find(candidate => candidate.kind === kind)
  if (project === undefined) {
    throw new Error(`The ${preset.id} preset has no ${kind}.`)
  }

  return project.name
}

/**
 * Scaffolds a preset into a workspace: the projects, then the wiring between them.
 *
 * @remarks
 * Each project is added through `mnci add`, so it is exactly what `add` makes, and then the preset edits them into
 * one working shape (see {@link wireWebApi}). Runs once the workspace exists, from `mnci new --preset`. The
 * current directory is the workspace while the projects are added, because `add` works from where it is run, and is
 * restored afterwards. It installs once at the end, since the wiring declares new workspace dependencies, then syncs
 * the TypeScript references and formats what was written.
 *
 * @param workspaceRoot - Absolute path to the new workspace.
 * @param presetId - The preset to apply.
 * @param dependencies - How to add, install, sync and format; real ones by default.
 * @returns A promise that resolves when the preset is in place.
 * @throws Error when the preset is unknown, a project cannot be added, or the install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export async function applyPreset (workspaceRoot: string, presetId: string, dependencies: Partial<PresetDependencies> = {}): Promise<void> {
  const preset = findPreset(presetId)
  const add = dependencies.add ?? runAdd
  const install = dependencies.install ?? ((root: string) => runShell('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], root))
  const sync = dependencies.sync ?? syncProjectReferences
  const format = dependencies.format ?? runFormatter

  logger.step(`Adding the ${preset.id} preset: ${preset.projects.map(project => project.name).join(', ')}`)
  const previous = process.cwd()
  process.chdir(workspaceRoot)
  try {
    for (const project of preset.projects) {
      await add(project.kind, project.name, project.options)
    }
  } finally {
    process.chdir(previous)
  }

  wireWebApi(workspaceRoot, { shared: nameOf(preset, 'internal-lib'), api: nameOf(preset, 'node-app'), web: nameOf(preset, 'react-app') })
  if (install(workspaceRoot) !== 0) {
    throw new Error('npm install failed after wiring the preset. Run `npm install` and read its error; the projects themselves were added.')
  }
  sync(workspaceRoot)
  format(workspaceRoot)
}
