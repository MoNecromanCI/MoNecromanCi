/**
 * How a workspace's native (cgo) apps are built in CI, read from the `mnci.native` entry of `nx.json`.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only through this barrel.
 */

export { DEFAULT_NATIVE_RUNNERS } from './native-build.contract'
export type { NativeBuildConfig, NativeBuildSettings } from './native-build.contract'
export { readNativeBuildConfig } from './read-native-build-config.use-case'
