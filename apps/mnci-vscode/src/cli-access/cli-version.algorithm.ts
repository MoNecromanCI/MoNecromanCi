/**
 * The oldest mnci CLI the extension can read.
 *
 * @remarks
 * 4.32.0 is the first release with the `--json` commands (`commands`, `kinds`, `projects`, `info`,
 * `doctor`) every view of the extension is built on. An older CLI answers them with
 * `unknown option '--json'`, so it is skipped when locating the CLI and named in the error when it
 * is reached anyway.
 */
export const MIN_CLI_VERSION = '4.32.0'

/**
 * The version a `mnci --version` printed.
 *
 * @remarks
 * Takes the first `major.minor.patch` in the text, so a banner or a warning line before the
 * number does not matter.
 *
 * @param output - What `mnci --version` printed.
 * @returns The three numbers, or `undefined` when none could be read.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function parseCliVersion (output: string): readonly [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output)
  if (match === null) {
    return undefined
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Whether a CLI version is at least the minimum the extension needs.
 *
 * @remarks
 * A version that cannot be read counts as too old: it is better to fetch a CLI that is known to work
 * than to run one that might not.
 *
 * @param output - What `mnci --version` printed.
 * @param minimum - The oldest acceptable version, `major.minor.patch`.
 * @returns True when the version is at least the minimum.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isCliVersionSupported (output: string, minimum: string = MIN_CLI_VERSION): boolean {
  const found = parseCliVersion(output)
  const wanted = parseCliVersion(minimum)
  if (found === undefined || wanted === undefined) {
    return false
  }
  for (const [index, number_] of found.entries()) {
    if (number_ !== wanted[index]) {
      return number_ > wanted[index]
    }
  }

  return true
}
