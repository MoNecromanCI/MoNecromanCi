/**
 * The edits that take one project out of the files that name it, each a pure function from text to text.
 *
 * @remarks
 * `mnci add` writes a project into several places besides its own folder (root scripts, launch configurations, the Go
 * workspace, the Dart workspace, the Cargo workspace, TypeScript path aliases). Each function here undoes one of them on the
 * text, leaving the rest of the file as it was, and returns the same text when the project is not named there, so a
 * caller can tell a change from a no-op by comparing.
 */

/**
 * Removes a module from a `go.work`'s `use` directive.
 *
 * @remarks
 * Both forms: a `use ( ... )` block and a single `use ./dir` line. A module is matched by its whole path, with or without
 * the leading `./`, so `apps/ap` never removes `apps/api`.
 *
 * @param text - The text of `go.work`.
 * @param directory - The workspace-relative directory of the module, such as `apps/api`.
 * @returns The text without that `use` entry; unchanged when it is not there.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeGoWorkUse (text: string, directory: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const wanted = new Set([directory, `./${directory}`])
  const lines = text.split(/\r?\n/)
  let inBlock = false
  const kept = lines.filter((line) => {
    const trimmed = line.trim()
    if (/^use\s*\(/.test(trimmed)) {
      inBlock = true

      return true
    }
    if (inBlock && trimmed === ')') {
      inBlock = false

      return true
    }
    if (inBlock) {
      return !wanted.has(trimmed)
    }
    const single = /^use\s+(\S+)\s*$/.exec(trimmed)

    return single === null || !wanted.has(single[1])
  })

  return kept.length === lines.length ? text : kept.join(newline)
}

/**
 * Removes a member from the root `pubspec.yaml`'s `workspace:` list.
 *
 * @remarks
 * Only the items under `workspace:` are considered, so a similar line in another section is never touched.
 *
 * @param text - The text of the root `pubspec.yaml`.
 * @param directory - The workspace-relative directory of the package.
 * @returns The text without that list item; unchanged when it is not there.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removePubspecWorkspaceMember (text: string, directory: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let inList = false
  const kept = lines.filter((line) => {
    if (/^workspace:\s*$/.test(line)) {
      inList = true

      return true
    }
    if (inList && /^\S/.test(line)) {
      inList = false
    }
    if (!inList) {
      return true
    }
    const item = /^\s*-\s*(\S+)\s*$/.exec(line)

    return item === null || item[1] !== directory
  })

  return kept.length === lines.length ? text : kept.join(newline)
}

/**
 * Removes a member from the root `Cargo.toml`'s `[workspace] members` array.
 *
 * @remarks
 * Handles the multi-line array `@monodon/rust` writes (one quoted path per line, either quote style). A one-line array is
 * handled too.
 *
 * @param text - The text of the root `Cargo.toml`.
 * @param directory - The workspace-relative directory of the crate.
 * @returns The text without that member; unchanged when it is not there.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeCargoWorkspaceMember (text: string, directory: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const quoted = new RegExp(String.raw`^\s*["']${directory.replaceAll(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`)}["'],?\s*$`)
  const kept = lines.filter(line => !quoted.test(line))
  if (kept.length !== lines.length) {
    return kept.join(newline)
  }
  const inline = new RegExp(String.raw`(["'])${directory.replaceAll(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`)}\1,?\s*`)

  return inline.test(text) ? text.replace(inline, '') : text
}

/**
 * Removes a module from the aggregator `pom.xml`'s `<modules>`.
 *
 * @remarks
 * By the exact directory, so `apps/web` does not take `apps/web2` with it. The module's own folder is removed elsewhere.
 *
 * @param text - The text of the root `pom.xml`.
 * @param directory - The module's workspace-relative directory.
 * @returns The text without the module's line; the same text when it was not listed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeMavenModule (text: string, directory: string): string {
  const escaped = directory.replaceAll(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`)

  return text.replace(new RegExp(String.raw`^[ \t]*<module>${escaped}</module>[ \t]*\r?\n`, 'm'), '')
}

/**
 * Removes a project's root scripts: every `<name>:<action>`.
 *
 * @remarks
 * By the exact `<name>:` prefix, so `web` does not take `web2:qa` or `web-e2e:qa` with it.
 *
 * @param scripts - The root manifest's `scripts`.
 * @param name - The project name.
 * @returns The scripts without the project's, and the names that were removed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeProjectScripts (
  scripts: Readonly<Record<string, string>>,
  name: string,
): { scripts: Record<string, string>, removed: string[] } {
  const removed = Object.keys(scripts).filter(key => key.startsWith(`${name}:`))
  const kept = Object.fromEntries(Object.entries(scripts).filter(([key]) => !removed.includes(key)))

  return { scripts: kept, removed }
}

/**
 * Removes the TypeScript path aliases that point into a removed project's directory.
 *
 * @remarks
 * An alias goes only when every one of its targets is inside the directory, and the directory is matched as a whole path
 * segment, so `libs/kit` does not take `libs/kit2`.
 *
 * @param paths - `compilerOptions.paths` of `tsconfig.base.json`.
 * @param directory - The workspace-relative directory of the project.
 * @returns The remaining aliases, and the alias names that were removed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removePathAliases (
  paths: Readonly<Record<string, readonly string[]>>,
  directory: string,
): { paths: Record<string, string[]>, removed: string[] } {
  const into = (target: string): boolean => {
    const normalised = target.replace(/^\.\//, '')

    return normalised === directory || normalised.startsWith(`${directory}/`)
  }
  const removed = Object.entries(paths)
    .filter(([, targets]) => targets.length > 0 && targets.every(target => into(target)))
    .map(([alias]) => alias)
  const kept = Object.fromEntries(Object.entries(paths).filter(([alias]) => !removed.includes(alias)).map(([alias, targets]) => [alias, [...targets]]))

  return { paths: kept, removed }
}
