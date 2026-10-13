/**
 * One library of a version catalog, with the version it resolves to.
 *
 * @remarks
 * What `mnci sync` and `mnci up` need of a catalog entry: the module, the version behind it and whether it may be edited.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CatalogLibrary {
  /** The catalog key, such as `ktor-server-core`. */
  alias:      string
  /** The Maven coordinate without a version, `group:artifact`. */
  module:     string
  /** The version, taken through its `[versions]` entry when the library names one by reference. */
  version:    string
  /**
   * Whether {@link replaceCatalogVersion} may change it: a literal version, or a reference nothing else uses (changing a
   * shared one would move libraries that each have their own latest release).
   */
  rewritable: boolean
}

/** The version shape `mnci up` can compare; anything else (a range, a rich constraint, a qualifier word) is not read. */
const COMPARABLE = /^\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?$/

/**
 * Splits a catalog into its tables.
 *
 * @param text - The text of `gradle/libs.versions.toml`.
 * @returns The lines of each `[table]`, by table name.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function tablesOf (text: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([\w-]+)\]\s*(?:#.*)?$/.exec(line)
    if (header === null) {
      current?.push(line)
    } else {
      current = []
      result.set(header[1], current)
    }
  }

  return result
}

/**
 * Reads the module and the way one `[libraries]` value names its version.
 *
 * @param value - The text after `=` on the line.
 * @returns The module and either a literal version or the `[versions]` key it refers to; `undefined` for a library that
 * names no version (a BOM manages it) or is in a shape this does not read.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function libraryOf (value: string): { module: string, literal?: string, ref?: string } | undefined {
  const short = /^"([^":\s]+:[^":\s]+):([^"\s]+)"/.exec(value)
  if (short !== null) {
    return { module: short[1], literal: short[2] }
  }
  if (!value.startsWith('{')) {
    return undefined
  }
  const group = /\bgroup\s*=\s*"([^"]+)"/.exec(value)?.[1]
  const name = /\bname\s*=\s*"([^"]+)"/.exec(value)?.[1]
  const module = /\bmodule\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? (group !== undefined && name !== undefined ? `${group}:${name}` : undefined)
  if (module === undefined) {
    return undefined
  }
  const ref = /\bversion\.ref\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? /\bversion\s*=\s*\{\s*ref\s*=\s*"([^"]+)"/.exec(value)?.[1]
  if (ref !== undefined) {
    return { module, ref }
  }
  const literal = /\bversion\s*=\s*"([^"]+)"/.exec(value)?.[1]

  return literal === undefined ? { module } : { module, literal }
}

/**
 * Escapes a text for use inside a regular expression.
 *
 * @param text - The text to match literally.
 * @returns The escaped text.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function escapeRegex (text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/**
 * Reads the libraries of a version catalog that name a version `mnci up` can compare.
 *
 * @remarks
 * `[libraries]` entries in the forms Gradle accepts (`{ module, version }`, `version.ref`, `version = { ref }`,
 * `group`/`name`, and the `"g:a:v"` string). A library with no version (managed by a BOM), a rich or range version, or a
 * reference to a missing key is not read. `[plugins]` entries are not read: a plugin is not a library, and its release page
 * is another place.
 *
 * @param text - The text of `gradle/libs.versions.toml`.
 * @returns One entry per library with a comparable version.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function catalogLibraries (text: string): CatalogLibrary[] {
  const tables = tablesOf(text)
  const versions = new Map<string, string>()
  const versionLines = tables.get('versions') ?? []
  for (const line of versionLines) {
    const match = /^\s*([\w.-]+)\s*=\s*"([^"]*)"/.exec(line)
    if (match !== null) {
      versions.set(match[1], match[2])
    }
  }
  // How many entries, libraries and plugins both, point at each `[versions]` key.
  const uses = new Map<string, number>()
  for (const [name, lines] of tables) {
    if (name === 'versions') {
      continue
    }
    for (const line of lines) {
      for (const match of line.matchAll(/\bref\s*=\s*"([^"]+)"/g)) {
        uses.set(match[1], (uses.get(match[1]) ?? 0) + 1)
      }
    }
  }

  const found: CatalogLibrary[] = []
  const libraryLines = tables.get('libraries') ?? []
  for (const line of libraryLines) {
    const entry = /^\s*([\w.-]+)\s*=(.*)$/.exec(line)
    const library = entry === null ? undefined : libraryOf((entry[2]).trim())
    if (entry === null || library === undefined) {
      continue
    }
    const version = library.literal ?? (library.ref === undefined ? undefined : versions.get(library.ref))
    if (version === undefined || !COMPARABLE.test(version)) {
      continue
    }
    found.push({
      alias:      entry[1],
      module:     library.module,
      version,
      rewritable: library.ref === undefined || uses.get(library.ref) === 1,
    })
  }

  return found
}

/**
 * Finds the first line of a table that matches a pattern.
 *
 * @param lines - The lines of the whole catalog.
 * @param table - The table name, without brackets.
 * @param matches - What the line must match.
 * @returns The index of the line, or -1 when no line of that table matches.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function indexInTable (lines: readonly string[], table: string, matches: RegExp): number {
  let current = ''
  for (const [index, line] of lines.entries()) {
    const header = /^\s*\[([\w-]+)\]/.exec(line)
    if (header !== null) {
      current = header[1]
    } else if (current === table && matches.test(line)) {
      return index
    }
  }

  return -1
}

/**
 * Puts a version between the two captured groups of a pattern.
 *
 * @param line - A catalog line.
 * @param pattern - A pattern with an opening and a closing group around the old version.
 * @param version - The version to write.
 * @returns The changed line.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function withVersion (line: string, pattern: RegExp, version: string): string {
  return line.replace(pattern, (_whole: string, open: string, close: string) => `${open}${version}${close}`)
}

/**
 * Changes the version of one catalog library, leaving the rest of the text as it was.
 *
 * @remarks
 * A literal version is replaced on the library's own line; a reference is replaced in `[versions]`, and only when no other
 * entry uses that key.
 *
 * @param text - The text of `gradle/libs.versions.toml`.
 * @param module - The library's `group:artifact`.
 * @param version - The new version.
 * @returns The new text; the same text when the library is not there or may not be changed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function replaceCatalogVersion (text: string, module: string, version: string): string {
  const library = catalogLibraries(text).find(entry => entry.module === module)
  if (library === undefined || !library.rewritable) {
    return text
  }
  const lines = text.split(/\r?\n/)
  const own = indexInTable(lines, 'libraries', new RegExp(String.raw`^\s*${escapeRegex(library.alias)}\s*=`))
  if (own === -1) {
    return text
  }
  const line = lines[own] ?? ''
  const ref = /\bversion\.ref\s*=\s*"([^"]+)"/.exec(line)?.[1] ?? /\bversion\s*=\s*\{\s*ref\s*=\s*"([^"]+)"/.exec(line)?.[1]
  if (ref === undefined) {
    const shortForm = /^\s*[\w.-]+\s*=\s*"[^":\s]+:[^":\s]+:[^"\s]+"/.test(line)
    const pattern = shortForm ? /("[^":\s]+:[^":\s]+:)[^"\s]+(")/ : /(\bversion\s*=\s*")[^"]*(")/
    lines[own] = withVersion(line, pattern, version)
  } else {
    const key = indexInTable(lines, 'versions', new RegExp(String.raw`^\s*${escapeRegex(ref)}\s*=`))
    if (key === -1) {
      return text
    }
    lines[key] = withVersion(lines[key] ?? '', /(=\s*")[^"]*(")/, version)
  }

  return lines.join(text.includes('\r\n') ? '\r\n' : '\n')
}
