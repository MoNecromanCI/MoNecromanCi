import type { AddOptions, ProjectKind } from '../project-scaffolding'

/**
 * One project a preset adds, with the options `mnci add` is given for it.
 *
 * @remarks
 * Added in the order the preset lists them, so a project that others depend on comes first.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PresetProject {
  /** The kind to add. */
  kind:    ProjectKind
  /** The project's name. */
  name:    string
  /** The flags `mnci add` takes for it. */
  options: AddOptions
}

/**
 * A shape of workspace that `mnci new --preset` scaffolds in one step.
 *
 * @remarks
 * The projects are added through `mnci add`, so each is exactly what `add` makes; what the preset adds beyond that is
 * the wiring between them, which its id selects.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface Preset {
  /** The name given to `--preset`. */
  id:       string
  /** What it makes, in one line. */
  summary:  string
  /** The projects, in the order they are added. */
  projects: readonly PresetProject[]
}

/**
 * Every preset `mnci new --preset` accepts.
 *
 * @remarks
 * `web-api` is a React frontend, an Express API and a shared library both use. A preset is a starting point to
 * edit, not a framework: delete what you do not need.
 */
export const PRESETS: readonly Preset[] = [
  {
    id:       'web-api',
    summary:  'a React frontend and an Express API that share one internal library: the web asks the API, the API answers with the shared greeting, and `mnci dev web api` starts both',
    projects: [
      { kind: 'internal-lib', name: 'shared', options: {} },
      { kind: 'node-app', name: 'api', options: { framework: 'express' } },
      { kind: 'react-app', name: 'web', options: {} },
    ],
  },
]

/**
 * The names `--preset` accepts.
 *
 * @remarks
 * Derived from {@link PRESETS}, so a preset added there is accepted by the command without another edit.
 */
export const PRESET_IDS: readonly string[] = PRESETS.map(preset => preset.id)
