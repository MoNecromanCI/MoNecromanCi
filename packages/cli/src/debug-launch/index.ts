/**
 * Debug launch configurations for the languages whose debugger is not Node's.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only through this barrel, never by a path into the files
 * below. A kind's scaffolding names a {@link DebugTarget}; the workspace file gets one `<prefix><name> debug` launch
 * configuration, and, for C++, the task that builds it first.
 */

export type { DebugNaming, DebugTarget } from './debug-target.contract'
export { debugBuildTask, debugBuildTaskLabel, debugLaunchConfiguration } from './debug-launch.mapper'
export { debugExtension, type DebugExtension } from './debug-extension.mapper'
