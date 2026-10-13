/**
 * A Maven coordinate as a user types it.
 *
 * @remarks
 * `group:artifact`, `group:artifact@version` or `group:artifact:version`.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export interface MavenCoordinate {
  groupId:    string
  artifactId: string
  version?:   string
}

/**
 * One `<dependency>` of a module's own `pom.xml`, with where it sits in the text.
 *
 * @remarks
 * Offsets are into the text the block was read from, so an edit by position never reserialises the file.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export interface MavenDependencyBlock {
  groupId:    string
  artifactId: string
  /** The `<version>` text as written (a literal, or a `${property}`), or `undefined` when the dependency names none. */
  version:    string | undefined
  /** The `<scope>` text, or `undefined` for the default (compile). */
  scope:      string | undefined
  /** Offset of the start of the line the `<dependency>` opens on. */
  start:      number
  /** Offset just past the line the `</dependency>` closes on, newline included. */
  end:        number
}

/**
 * Reads a Maven coordinate.
 *
 * @remarks
 * Maven names a library by two parts that cannot be guessed from one word, so a coordinate is `group:artifact`, with the
 * version after an `@` (as npm's `name@version` is written) or a second colon (as Maven writes it).
 *
 * @param specifier - What the user typed after `mnci install`.
 * @returns The coordinate, or `undefined` when it is not one (no group, no artifact, or more than three parts).
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function parseMavenCoordinate (specifier: string): MavenCoordinate | undefined {
  const [head, atVersion] = specifier.split('@') as [string, string | undefined]
  const parts = head.split(':')
  if (atVersion === '' || parts.length < 2 || parts.length > 3 || parts.some(part => part.length === 0)) {
    return undefined
  }
  const [groupId, artifactId, colonVersion] = parts as [string, string, string | undefined]
  const version = atVersion ?? colonVersion

  return { groupId, artifactId, ...(version !== undefined && { version }) }
}

/**
 * Reads the element tree of a `pom.xml` as far as the top-level `<dependencies>` and their blocks.
 *
 * @remarks
 * A depth scan over the tags, ignoring comments, so a `<dependencies>` inside `<build><plugins>`, `<dependencyManagement>`
 * or a profile is never mistaken for the module's own. Positions are offsets into the text, which is edited by position and
 * never reserialised, so everything around the change keeps its formatting.
 *
 * @param text - The text of a module's `pom.xml`.
 * @returns The own `<dependencies>` (open and close offsets, and its blocks), or `undefined` when the module has none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function ownDependencies (text: string): { close: number, blocks: MavenDependencyBlock[] } | undefined {
  const tags = /<!--[\s\S]*?-->|<(\/?)([A-Z][\w.:-]*)\b[^>]*?(\/?)>/gi
  const stack: string[] = []
  const blocks: MavenDependencyBlock[] = []
  let close: number | undefined
  let blockStart = 0
  let blockOpen = 0
  for (let match = tags.exec(text); match !== null; match = tags.exec(text)) {
    const [whole, closing, name, selfClosing] = match as unknown as [string, string | undefined, string | undefined, string | undefined]
    if (name === undefined || selfClosing === '/') {
      continue
    }
    if (closing === '/') {
      if (name === 'dependency' && stack.length === 3 && stack[1] === 'dependencies') {
        const lineStart = text.lastIndexOf('\n', blockOpen) + 1
        const lineEnd = text.indexOf('\n', match.index + whole.length)
        const body = text.slice(blockStart, match.index)
        blocks.push({
          groupId:    /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(body)?.[1] ?? '',
          artifactId: /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(body)?.[1] ?? '',
          version:    /<version>\s*([^<\s]+)\s*<\/version>/.exec(body)?.[1],
          scope:      /<scope>\s*([^<\s]+)\s*<\/scope>/.exec(body)?.[1],
          start:      lineStart,
          end:        lineEnd === -1 ? text.length : lineEnd + 1,
        })
      }
      if (name === 'dependencies' && stack.length === 2 && stack[0] === 'project') {
        close = match.index
      }
      stack.pop()
      continue
    }
    if (name === 'dependency' && stack.length === 2 && stack[1] === 'dependencies') {
      blockOpen = match.index
      blockStart = match.index + whole.length
    }
    stack.push(name)
  }

  return close === undefined ? undefined : { close, blocks }
}

/**
 * The dependencies a module's own `pom.xml` declares.
 *
 * @remarks
 * Only the module's own `<dependencies>`: not those of a plugin, `<dependencyManagement>` or a profile.
 *
 * @param text - The text of a module's `pom.xml`.
 * @returns Each dependency's group and artifact, in file order.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function mavenDependencies (text: string): Array<{ groupId: string, artifactId: string }> {
  return (ownDependencies(text)?.blocks ?? []).map(({ groupId, artifactId }) => ({ groupId, artifactId }))
}

/**
 * The dependencies a module's own `pom.xml` declares, with the version and scope each names.
 *
 * @remarks
 * The same selection as {@link mavenDependencies}. A dependency whose version is managed elsewhere (the parent or a BOM) has
 * no `version`; one written as `${property}` carries that text, which a caller must not treat as a version.
 *
 * @param text - The text of a module's `pom.xml`.
 * @returns Each dependency, in file order.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function mavenDependencyDeclarations (
  text: string,
): Array<{ groupId: string, artifactId: string, version: string | undefined, scope: string | undefined }> {
  return (ownDependencies(text)?.blocks ?? []).map(({ groupId, artifactId, version, scope }) => ({ groupId, artifactId, version, scope }))
}

/**
 * Changes the `<version>` of one dependency in a module's own `<dependencies>`, leaving the rest of the text as it was.
 *
 * @remarks
 * Edited by position inside that dependency's block, so a plugin's or `dependencyManagement`'s entry for the same artifact is
 * never touched. A dependency with no literal `<version>` is left alone.
 *
 * @param text - The text of a module's `pom.xml`.
 * @param name - `group:artifact`.
 * @param version - The new version.
 * @returns The new text; the same text when the dependency is not declared with a version.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function replaceMavenVersion (text: string, name: string, version: string): string {
  const block = (ownDependencies(text)?.blocks ?? []).find(entry => `${entry.groupId}:${entry.artifactId}` === name)
  if (block === undefined) {
    return text
  }
  const body = text.slice(block.start, block.end)
  const next = body.replace(/(<version>\s*)[^<\s]+(\s*<\/version>)/, (_whole, open: string, close: string) => `${open}${version}${close}`)

  return text.slice(0, block.start) + next + text.slice(block.end)
}

/**
 * The group, artifact and version a module's `pom.xml` names for itself.
 *
 * @remarks
 * The group falls back to the parent's when the module declares none, and the version is the module's own, not the
 * parent's: both come from the text after `</parent>`.
 *
 * @param text - The text of a module's `pom.xml`.
 * @returns The identity, or `undefined` when there is no `artifactId`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function mavenModuleIdentity (text: string): { groupId: string, artifactId: string, version: string } | undefined {
  const parentEnd = text.indexOf('</parent>')
  // Only the module's own header: what comes before its dependencies, build and properties, which carry groups and versions too.
  const own = (parentEnd === -1 ? text : text.slice(parentEnd)).split(/<(?:dependencies|dependencyManagement|build|profiles|properties)\b/, 1)[0] ?? ''
  const artifactId = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(own)?.[1]
  if (artifactId === undefined) {
    return undefined
  }
  const groupId = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(own)?.[1] ?? /<parent>[\s\S]*?<groupId>\s*([^<\s]+)/.exec(text)?.[1] ?? ''
  const version = /<version>\s*([^<\s]+)\s*<\/version>/.exec(own)?.[1] ?? ''

  return { groupId, artifactId, version }
}

/**
 * Adds a dependency to a module's own `<dependencies>`, once.
 *
 * @remarks
 * Idempotent on the group and artifact: a dependency that is already declared is left exactly as it is, whatever its
 * version, because changing a version is `mnci up`'s job. A module with no `<dependencies>` gets one before `<build>` (or
 * before `</project>`). The block is indented to match the closing tag it goes before.
 *
 * @param text - The text of a module's `pom.xml`.
 * @param dependency - What to add; `scope` is written when given (`test` for `--save-dev`).
 * @returns The text with the dependency declared; the same text when it already was.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addMavenDependency (
  text: string,
  dependency: { groupId: string, artifactId: string, version: string, scope?: string },
): string {
  const found = ownDependencies(text)
  if (found?.blocks.some(block => block.groupId === dependency.groupId && block.artifactId === dependency.artifactId) === true) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const block = (indent: string): string[] => [
    `${indent}<dependency>`,
    `${indent}  <groupId>${dependency.groupId}</groupId>`,
    `${indent}  <artifactId>${dependency.artifactId}</artifactId>`,
    `${indent}  <version>${dependency.version}</version>`,
    ...(dependency.scope === undefined ? [] : [`${indent}  <scope>${dependency.scope}</scope>`]),
    `${indent}</dependency>`,
  ]
  if (found !== undefined) {
    const lineStart = text.lastIndexOf('\n', found.close) + 1
    const closeIndent = /^[ \t]*/.exec(text.slice(lineStart, found.close))?.[0] ?? ''

    return text.slice(0, lineStart) + block(`${closeIndent}  `).join(newline) + newline + text.slice(lineStart)
  }
  const build = /^[ \t]*<build>/m.exec(text)
  const end = build?.index ?? text.lastIndexOf('</project>')
  if (end === -1) {
    return text
  }
  const wrapper = ['  <dependencies>', ...block(' '.repeat(4)), '  </dependencies>', ''].join(newline)

  return text.slice(0, end) + wrapper + newline + text.slice(end)
}

/**
 * Removes a dependency from a module's own `<dependencies>`.
 *
 * @remarks
 * By `group:artifact`, or by the artifact alone when exactly one declared dependency has that artifact: a bare name that
 * would match two is left alone, so nothing is removed on a guess.
 *
 * @param text - The text of a module's `pom.xml`.
 * @param name - `group:artifact`, or an artifact id.
 * @returns The text, and whether anything was removed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeMavenDependency (text: string, name: string): { text: string, removed: boolean } {
  const coordinate = parseMavenCoordinate(name)
  const blocks = ownDependencies(text)?.blocks ?? []
  const matches = coordinate === undefined
    ? blocks.filter(block => block.artifactId === name)
    : blocks.filter(block => block.groupId === coordinate.groupId && block.artifactId === coordinate.artifactId)
  if (matches.length !== 1) {
    return { text, removed: false }
  }
  const [block] = matches as [MavenDependencyBlock]

  return { text: text.slice(0, block.start) + text.slice(block.end), removed: true }
}
