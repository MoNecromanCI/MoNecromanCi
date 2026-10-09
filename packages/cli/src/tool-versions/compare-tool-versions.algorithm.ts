/**
 * The numeric parts of a version or pin, as written: `24` is one part, `1.27` two, `2.14.0` three.
 *
 * @remarks
 * A leading `v` or `go` is ignored, and a wildcard part (`10.0.x`) ends the version, so `10.0.x` reads as `[10, 0]`.
 * How many parts a pin has is how precisely mnci pins it: a Node major, a Go minor, a full golangci-lint version.
 *
 * @param version - A version or a pin.
 * @returns The leading numeric parts, which may be empty when none can be read.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function versionParts (version: string): number[] {
  const parts: number[] = []
  for (const part of version.replace(/^(?:go|v)/u, '').split('.')) {
    if (!/^\d+$/u.test(part)) {
      break
    }
    parts.push(Number(part))
  }

  return parts
}

/**
 * Whether a release is newer than a pin, compared at the pin's own precision.
 *
 * @remarks
 * A pin of `24` is newer-than only by a higher major (`26.1.0` is, `24.9.0` is not); `1.27` only by a higher minor;
 * `2.14.0` by any higher version. Comparing a major pin to a full release number would call every patch of the
 * pinned major "newer", which is not a finding.
 *
 * @param pinned - What mnci pins.
 * @param latest - The newest release the tool's own source reports.
 * @returns True when the release is newer at the pin's precision; false when equal, older, or unreadable.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isNewerThanPin (pinned: string, latest: string): boolean {
  const pin = versionParts(pinned)
  const release = versionParts(latest)
  if (pin.length === 0 || release.length < pin.length) {
    return false
  }
  for (const [index, part] of pin.entries()) {
    if (release[index] !== part) {
      return release[index] > part
    }
  }

  return false
}
