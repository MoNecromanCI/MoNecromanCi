/**
 * Finding the mnci CLI and asking it for JSON.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export type { CliLocation } from './cli-location.contract'
export { isCliVersionSupported, MIN_CLI_VERSION } from './cli-version.algorithm'
export { locateCli, type LocateOptions, type LocateProbes } from './locate-cli.use-case'
export { MACHINE_PROBES } from './machine-probes.client'
export { runMnciJson, type CliJsonResult } from './run-mnci-json.client'
