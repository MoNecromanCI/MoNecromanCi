const BEGIN = '// mnci:dependencies'
const END = '// mnci:dependencies-end'

/**
 * The catalog alias a library gets: its artifact id, lowercased, with `.` and `_` as `-`.
 *
 * @remarks
 * A TOML key may hold `-`, `_` and `.`, and Gradle exposes `a-b` as `libs.a.b`. The artifact id alone is kept readable;
 * {@link addCatalogLibrary} prefixes the group's last segment only when another library already holds it.
 *
 * @param artifactId - The Maven artifact id.
 * @returns The alias.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function catalogAlias (artifactId: string): string {
  return artifactId.toLowerCase().replaceAll(/[._]+/g, '-')
}

/**
 * The accessor a catalog alias is used as in a build file: `ktor-server-core` is `libs.ktor.server.core`.
 *
 * @remarks
 * A pure text transform of the catalog or build file: nothing is read from or written to disk here.
 *
 * @param alias - The catalog alias.
 * @returns The `libs.` accessor.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function catalogAccessor (alias: string): string {
  return `libs.${alias.replaceAll('-', '.')}`
}

/**
 * Adds a library to the `[libraries]` table of a version catalog.
 *
 * @remarks
 * A library already declared with the same module is reused (its alias returned, the text unchanged). Another library that
 * holds the alias makes the alias `<group's last segment>-<artifact>`. The table is created when the catalog has none.
 *
 * @param text - The text of `gradle/libs.versions.toml`.
 * @param groupId - The library's group.
 * @param artifactId - The library's artifact id.
 * @param version - The version to pin.
 * @returns The new text and the alias the library has.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addCatalogLibrary (text: string, groupId: string, artifactId: string, version: string): { text: string, alias: string } {
  const module = `${groupId}:${artifactId}`
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === '[libraries]')
  const end = start === -1 ? -1 : lines.findIndex((line, index) => index > start && /^\s*\[/.test(line))
  if (start !== -1) {
    const table = lines.slice(start + 1, end === -1 ? undefined : end)
    const existing = table.find(line => line.includes(`"${module}"`) && /^\s*[\w.-]+\s*=/.test(line))
    if (existing !== undefined) {
      return { text, alias: /^\s*([\w.-]+)\s*=/.exec(existing)?.[1] ?? catalogAlias(artifactId) }
    }
  }
  const taken = new Set(lines.map(line => /^\s*([\w.-]+)\s*=/.exec(line)?.[1]).filter((key): key is string => key !== undefined))
  const plain = catalogAlias(artifactId)
  const alias = taken.has(plain) ? `${catalogAlias(groupId.split('.').pop() ?? 'lib')}-${plain}` : plain
  const entry = `${alias} = { module = "${module}", version = "${version}" }`
  if (start === -1) {
    const body = text.replace(/\s+$/, '')

    return { text: `${body}${newline}${newline}[libraries]${newline}${entry}${newline}`, alias }
  }
  let insertAt = end === -1 ? lines.length : end
  while (insertAt > start + 1 && lines[insertAt - 1]?.trim() === '') {
    insertAt -= 1
  }
  lines.splice(insertAt, 0, entry)

  return { text: lines.join(newline), alias }
}

/**
 * Removes a library from the `[libraries]` table by alias.
 *
 * @remarks
 * A pure text transform of the catalog or build file: nothing is read from or written to disk here.
 *
 * @param text - The text of the catalog.
 * @param alias - The alias to remove.
 * @returns The text without the entry; unchanged when it is not there.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeCatalogLibrary (text: string, alias: string): string {
  const escaped = alias.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

  return text.replace(new RegExp(String.raw`^${escaped}\s*=.*(?:\r?\n|$)`, 'm'), '')
}

/**
 * Adds a dependency line between the markers of a project's `build.gradle.kts`.
 *
 * @remarks
 * Only the lines between the two comment markers are mnci's. A build file without them (one the team reshaped) is refused,
 * not guessed at: `refused` is true and the text is returned unchanged. A line already there is left as it is.
 *
 * @param text - The text of the build file.
 * @param line - The dependency declaration, e.g. `implementation(libs.guava)`.
 * @returns The new text, and whether the markers were missing.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addDependencyLine (text: string, line: string): { text: string, refused: boolean } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const begin = lines.findIndex(each => each.trim() === BEGIN)
  const end = lines.findIndex((each, index) => index > begin && each.trim() === END)
  if (begin === -1 || end === -1) {
    return { text, refused: true }
  }
  if (lines.slice(begin + 1, end).some(each => each.trim() === line)) {
    return { text, refused: false }
  }
  const indent = /^\s*/.exec(lines[begin] ?? '')?.[0] ?? ' '.repeat(4)
  lines.splice(end, 0, `${indent}${line}`)

  return { text: lines.join(newline), refused: false }
}

/**
 * Removes the dependency lines between the markers that a predicate accepts.
 *
 * @remarks
 * A pure text transform of the catalog or build file: nothing is read from or written to disk here.
 *
 * @param text - The text of the build file.
 * @param matches - Predicates on a trimmed line; a line any of them accepts goes.
 * @returns The new text and how many lines were removed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeDependencyLines (text: string, matches: ReadonlyArray<(line: string) => boolean>): { text: string, removed: number } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const begin = lines.findIndex(each => each.trim() === BEGIN)
  const end = lines.findIndex((each, index) => index > begin && each.trim() === END)
  if (begin === -1 || end === -1) {
    return { text, removed: 0 }
  }
  const kept = lines.filter((each, index) => index <= begin || index >= end || matches.every(match => !match(each.trim())))

  return { text: kept.join(newline), removed: lines.length - kept.length }
}

/**
 * The dependency lines currently between the markers.
 *
 * @remarks
 * A pure text transform of the catalog or build file: nothing is read from or written to disk here.
 *
 * @param text - The text of the build file.
 * @returns The trimmed lines; empty when the markers are missing.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function readDependencyLines (text: string): string[] {
  const lines = text.split(/\r?\n/)
  const begin = lines.findIndex(each => each.trim() === BEGIN)
  const end = lines.findIndex((each, index) => index > begin && each.trim() === END)

  return begin === -1 || end === -1 ? [] : lines.slice(begin + 1, end).map(each => each.trim()).filter(Boolean)
}
