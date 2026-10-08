/** A version written `major.minor.patch`, with an optional range prefix. */
const VERSION = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/

/**
 * Whether a dependency belongs to the Nx family that has to move together.
 *
 * @remarks
 * `nx` and every `@nx/*` package release in lockstep, and a mix of two versions is what npm resolves into
 * nested copies and duplicated advisories. `@nx-go/nx-go` is a different project with its own versions and
 * is not part of the family.
 *
 * @param name - A dependency name.
 * @returns True for `nx` and for names under `@nx/`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isNxFamily (name: string): boolean {
  return name === 'nx' || name.startsWith('@nx/')
}

/**
 * Compares two `major.minor.patch` versions.
 *
 * @param left - The first version.
 * @param right - The second version.
 * @returns Negative when `left` is older, positive when newer, 0 when equal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function compare (left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)

  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || 0
}

/**
 * Chooses the version the Nx family is aligned to.
 *
 * @remarks
 * An explicit request wins. Otherwise the newest published stable version in the major the workspace
 * already uses, so adoption fixes advisories patched within the line without taking a breaking change.
 * `undefined` when the family is not declared, or nothing newer than the declared versions is published.
 *
 * @param declared - Every dependency of the root manifest, name to range.
 * @param published - Versions of `nx` the registry lists.
 * @param requested - A version the person asked for.
 * @returns The version to pin, or `undefined` when there is nothing to align.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function chooseNxVersion (declared: Readonly<Record<string, string>>, published: readonly string[], requested?: string): string | undefined {
  const current = Object.entries(declared)
    .filter(([name]) => isNxFamily(name))
    .map(([, range]) => VERSION.exec(range))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => `${match[1]}.${match[2]}.${match[3]}`)
  if (current.length === 0) {
    return undefined
  }
  if (requested !== undefined) {
    return requested
  }
  const newest = current.toSorted((a, b) => compare(a, b)).at(-1) as string
  const major = newest.split('.', 1)[0]
  const candidates = published.filter(version => /^\d+\.\d+\.\d+$/.test(version) && version.split('.', 1)[0] === major)

  return candidates.toSorted((a, b) => compare(a, b)).at(-1)
}

/**
 * Pins every Nx family dependency to one exact version.
 *
 * @remarks
 * Exact, not a range: a family at `^23.1.1` and `23.1.1` is two declarations of one decision.
 *
 * @param dependencies - A `dependencies` or `devDependencies` map.
 * @param version - The version to pin.
 * @returns The same map with each Nx family entry set to `version`, and the names that changed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function alignNxFamily (dependencies: Readonly<Record<string, string>>, version: string): { dependencies: Record<string, string>, changed: string[] } {
  const changed: string[] = []
  const aligned = Object.fromEntries(Object.entries(dependencies).map(([name, range]) => {
    if (range !== version && isNxFamily(name)) {
      changed.push(name)

      return [name, version]
    }

    return [name, range]
  }))

  return { dependencies: aligned, changed }
}
