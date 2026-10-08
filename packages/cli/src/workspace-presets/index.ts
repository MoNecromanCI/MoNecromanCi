/**
 * Whole shapes of workspace scaffolded in one step (`mnci new --preset`).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { applyPreset, findPreset } from './apply-preset.use-case'
export { PRESET_IDS } from './preset-catalog.config'
