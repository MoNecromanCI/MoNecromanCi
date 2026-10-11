/** The `Cargo.toml` tables that declare a crate's dependencies, with the section label `mnci up` shows for each. */
const CARGO_TABLES: Readonly<Record<string, 'dep' | 'devDep' | 'buildDep'>> = {
  '[dependencies]':       'dep',
  '[dev-dependencies]':   'devDep',
  '[build-dependencies]': 'buildDep',
}

/**
 * One crate dependency read from a `Cargo.toml`.
 *
 * @remarks
 * What `mnci sync` and `mnci up` need of a declaration: the name, the requirement, the table and whether it may be edited.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CargoDependency {
  /** The crate name, as the manifest spells it. */
  name:       string
  /** The version requirement, such as `1.0` or `^0.9`; empty when none is declared (a workspace or path dependency). */
  spec:       string
  /** Which table declared it. */
  section:    'dep' | 'devDep' | 'buildDep'
  /** Whether {@link replaceCargoSpec} can edit it: a plain version string, or an inline table with its own `version`. */
  rewritable: boolean
}

/**
 * Splits a `name = value` line of a dependency table.
 *
 * @remarks
 * By the first `=` and a name check rather than one regular expression, which would backtrack on a long value.
 *
 * @param line - A line of a dependency table.
 * @returns The indentation, name and trimmed value, or `undefined` when the line is not an assignment to a plain key.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function entryOf (line: string): { indent: string, name: string, value: string } | undefined {
  const equals = line.indexOf('=')
  if (equals === -1) {
    return undefined
  }
  const key = line.slice(0, equals)
  const name = key.trim()
  if (!/^[\w-]+$/.test(name)) {
    return undefined
  }

  return { indent: key.slice(0, key.length - key.trimStart().length), name, value: line.slice(equals + 1).trim() }
}

/**
 * Reads the version requirement out of the right-hand side of a dependency line.
 *
 * @param value - The text after `=`.
 * @returns The requirement and whether it can be rewritten, or `undefined` when the value declares none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function versionOf (value: string): { spec: string, rewritable: boolean } | undefined {
  const plain = /^"([^"]*)"/.exec(value) ?? /^'([^']*)'/.exec(value)
  if (plain !== null) {
    return { spec: plain[1], rewritable: true }
  }
  if (value.startsWith('{')) {
    const inline = /\bversion\s*=\s*"([^"]*)"/.exec(value)
    if (inline === null) {
      return undefined
    }

    // A crate with a `path` is a sibling in this workspace: its version is its own, so it is reported and left alone.
    return { spec: inline[1], rewritable: !/\bpath\s*=/.test(value) }
  }

  return undefined
}

/**
 * Reads the dependencies a `Cargo.toml` declares.
 *
 * @remarks
 * Done on the text, as the Python and Dart manifests are: `[dependencies]`, `[dev-dependencies]` and
 * `[build-dependencies]`, in the two shapes `cargo add` writes (`serde = "1"` and `serde = { version = "1", features = [...] }`).
 * A dependency that is `workspace = true`, a git or path dependency without a version, or a `[dependencies.name]` table is not
 * read: there is no version of the crate to compare. A target-specific table (`[target.'cfg(...)'.dependencies]`) is not read
 * either.
 *
 * @param content - The text of `Cargo.toml`.
 * @returns One entry per dependency with a version requirement.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function cargoDependencies (content: string): CargoDependency[] {
  const found: CargoDependency[] = []
  let section: CargoDependency['section'] | undefined

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      section = CARGO_TABLES[trimmed.replaceAll(/\s+/g, '')]
      continue
    }
    if (section === undefined || trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const entry = entryOf(line)
    const version = entry === undefined ? undefined : versionOf(entry.value)
    if (entry !== undefined && version !== undefined) {
      found.push({ name: entry.name, spec: version.spec, section, rewritable: version.rewritable })
    }
  }

  return found
}

/**
 * Replaces one crate's version requirement in a `Cargo.toml`, leaving everything else as it was.
 *
 * @remarks
 * Minimal edit on the text so comments and formatting survive, as for the other text manifests. Only the first dependency
 * table that declares the crate is changed, and only its version: features, `optional` and the rest of an inline table are
 * kept.
 *
 * @param content - The text of `Cargo.toml`.
 * @param name - The crate to change.
 * @param spec - The new requirement.
 * @returns The new text; the same text when the crate is not declared with a version.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function replaceCargoSpec (content: string, name: string, spec: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  let inDependencies = false

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (trimmed.startsWith('[')) {
      inDependencies = CARGO_TABLES[trimmed.replaceAll(/\s+/g, '')] !== undefined
      continue
    }
    const entry = inDependencies ? entryOf(lines[index]) : undefined
    if (entry === undefined || entry.name !== name) {
      continue
    }
    const { value } = entry
    let next: string | undefined
    if (/^["']/.test(value)) {
      next = value.replace(/^(["'])[^"']*\1/, (_whole, quote: string) => `${quote}${spec}${quote}`)
    } else if (value.startsWith('{') && /\bversion\s*=\s*"[^"]*"/.test(value)) {
      next = value.replace(/(\bversion\s*=\s*")[^"]*(")/, (_whole, open: string, close: string) => `${open}${spec}${close}`)
    }
    if (next === undefined) {
      return content
    }
    lines[index] = `${entry.indent}${name} = ${next}`

    return lines.join(newline)
  }

  return content
}

/**
 * The version of a crate a `Cargo.lock` resolved.
 *
 * @remarks
 * One lockfile serves the whole Cargo workspace, which is why Rust can answer what pip and NuGet cannot. A crate present at
 * several versions (two majors pulled in by different dependents) answers with the highest.
 *
 * @param lockText - The text of `Cargo.lock`.
 * @param name - The crate name.
 * @returns The resolved version, or `undefined` when the lockfile does not hold the crate.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function cargoLockVersion (lockText: string, name: string): string | undefined {
  const versions: string[] = []
  for (const block of lockText.split(/\n\s*\n/)) {
    if (!block.includes('[[package]]')) {
      continue
    }
    const crate = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    if (crate === name && version !== undefined) {
      versions.push(version)
    }
  }

  return versions.toSorted(compareVersions)[0]
}

/**
 * The first three numeric parts of a version.
 *
 * @param version - A version such as `1.0.9`.
 * @returns Its major, minor and patch, with anything non-numeric as zero.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function numericParts (version: string): number[] {
  return version.split(/[.+-]/).slice(0, 3).map(part => Number(part) || 0)
}

/**
 * Orders two versions, highest first, by their first three numeric parts.
 *
 * @param left - A version such as `1.0.9`.
 * @param right - Another.
 * @returns Negative when `left` is the higher.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function compareVersions (left: string, right: string): number {
  const [a, b] = [numericParts(left), numericParts(right)]

  return (b[0] - a[0]) || (b[1] - a[1]) || (b[2] - a[2])
}
