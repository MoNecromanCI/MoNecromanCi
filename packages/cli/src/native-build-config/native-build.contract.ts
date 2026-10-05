/**
 * What a workspace may say about how its native (cgo) apps are built in CI.
 *
 * @remarks
 * Persisted as the `native` entry of the `mnci` block in `nx.json`, so most workspaces never edit
 * pipeline YAML for it. Both fields are optional and replace the default whole when present.
 *
 * - `linuxPackages` are installed with `apt-get` next to the compiler and `pkg-config` that every
 *   cgo build needs, on a Linux leg only. A tray icon wants `libgtk-3-dev` and
 *   `libayatana-appindicator3-dev`, a database driver something else; mnci cannot know.
 * - `runners` are the runner labels (GitHub) or VM images (Azure) of the legs, one per OS the app
 *   ships for.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface NativeBuildConfig {
  /** Extra Debian packages installed before a Linux leg builds. */
  linuxPackages: string[]
  /** The runner of each leg of the native job. */
  runners:       string[]
}

/**
 * The runners a native job uses when the workspace names none: one per OS mnci ships for.
 *
 * @remarks
 * The labels are valid both as GitHub `runs-on` values and as Azure `vmImage` values.
 */
export const DEFAULT_NATIVE_RUNNERS = ['windows-latest', 'macos-latest', 'ubuntu-latest'] as const

/**
 * The result of reading the native build settings.
 *
 * @remarks
 * Problems are returned rather than thrown so `mnci doctor` can report them and a pipeline can
 * still be generated from the valid part.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface NativeBuildSettings {
  /** The settings, with every default filled in. */
  config:   NativeBuildConfig
  /** What is wrong with the `native` entry, one line each; empty when it is valid or absent. */
  problems: string[]
}
