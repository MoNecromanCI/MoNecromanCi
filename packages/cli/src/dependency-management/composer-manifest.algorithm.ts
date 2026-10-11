/**
 * The few facts `mnci` reads from a `composer.json`.
 *
 * @remarks
 * The package name, and the version a publishable library keeps under `extra.mnci`.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export interface ComposerIdentity {
  /** `<vendor>/<package>`. */
  name:     string
  /** `extra.mnci.version`, which a publishable library carries (Composer takes a published version from the tag). */
  version?: string
}

/**
 * The indentation a JSON file uses, so a rewrite does not reformat it.
 *
 * @param text - The file's text.
 * @returns The first indent found, four spaces when there is none (Composer's own).
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function indentOf (text: string): string {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? ' '.repeat(4)
}

/**
 * Reads a package's name and, for a library, its `extra.mnci.version`.
 *
 * @remarks
 * Read from the parsed JSON, so key order and indentation do not matter.
 *
 * @param text - The text of a `composer.json`.
 * @returns The identity, or `undefined` when the text is not JSON or has no `name`.
 * @throws Never - invalid JSON is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
export function composerIdentity (text: string): ComposerIdentity | undefined {
  try {
    const manifest = JSON.parse(text) as { name?: unknown, extra?: { mnci?: { version?: unknown } } }
    if (typeof manifest.name !== 'string') {
      return undefined
    }
    const version = manifest.extra?.mnci?.version

    return { name: manifest.name, ...((typeof version === 'string') && { version }) }
  } catch {
    return undefined
  }
}

/**
 * The Composer constraint that follows a version's compatible releases: `0.1.0` is `^0.1`, `2.3.4` is `^2.3`.
 *
 * @remarks
 * A caret on the first two parts, which for a `0.x` version is the only range that excludes the next minor, where
 * breaking changes are allowed.
 *
 * @param version - A `major.minor.patch` version.
 * @returns The constraint, or `*` for a version that is not that shape.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function caretConstraint (version: string): string {
  const match = /^(\d+)\.(\d+)/.exec(version)

  return match === null ? '*' : `^${match[1]}.${match[2]}`
}

/**
 * Declares a sibling package as a `path` repository of a project's `composer.json`, once.
 *
 * @remarks
 * How an internal library is consumed: Composer symlinks (or, on Windows, junctions) the sibling's directory into the
 * consumer's `vendor/`, so an edit to the library is seen at once. `options.versions` gives the path package the version it
 * declares, so a consumer can require `^0.1` and `composer validate --strict` has no unbound constraint to warn about.
 * Idempotent: a repository that points at the same directory is left alone.
 *
 * @param text - The text of the consumer's `composer.json`.
 * @param relativePath - The sibling's directory relative to the consumer's, forward-slashed.
 * @param packageName - The sibling's package name (`vendor/name`).
 * @param version - The version the sibling declares.
 * @returns The text with the repository declared.
 * @throws Error when the text is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function addPathRepository (text: string, relativePath: string, packageName: string, version: string): string {
  const manifest = JSON.parse(text) as { repositories?: Array<Record<string, unknown>> } & Record<string, unknown>
  const repositories = manifest.repositories ?? []
  if (repositories.some(repository => repository.type === 'path' && repository.url === relativePath)) {
    return text
  }
  manifest.repositories = [
    ...repositories,
    { type: 'path', url: relativePath, options: { symlink: true, versions: { [packageName]: version } } },
  ]
  const newline = text.includes('\r\n') ? '\r\n' : '\n'

  return JSON.stringify(manifest, undefined, indentOf(text)).split('\n').join(newline) + newline
}

/**
 * Removes the `path` repository that points at a sibling's directory.
 *
 * @remarks
 * By the repository's `url`, which is what {@link addPathRepository} wrote. Nothing else in the manifest is touched.
 *
 * @param text - The text of the consumer's `composer.json`.
 * @param relativePath - The sibling's directory relative to the consumer's, forward-slashed.
 * @returns The text without it; the same text when there was none. `repositories` goes when it empties.
 * @throws Error when the text is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function removePathRepository (text: string, relativePath: string): string {
  const manifest = JSON.parse(text) as { repositories?: Array<Record<string, unknown>> } & Record<string, unknown>
  const repositories = manifest.repositories ?? []
  const kept = repositories.filter(repository => !(repository.type === 'path' && repository.url === relativePath))
  if (kept.length === repositories.length) {
    return text
  }
  if (kept.length > 0) {
    manifest.repositories = kept
  } else {
    delete manifest.repositories
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'

  return JSON.stringify(manifest, undefined, indentOf(text)).split('\n').join(newline) + newline
}
