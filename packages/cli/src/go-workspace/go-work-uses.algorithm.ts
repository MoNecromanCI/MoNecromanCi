/**
 * The module directories a `go.work` file lists in its `use` directives.
 *
 * @remarks
 * Handles both spellings Go accepts, `use ./apps/api` and a `use ( ... )` block with one directory per line, and
 * ignores `//` comments and quotes around a path. Directories come back as written, so a leading `./` stays.
 *
 * @param goWork - The text of a `go.work` file.
 * @returns The directories in file order, without duplicates.
 * @throws Never - pure text work; text that is not a `go.work` yields no entries.
 * @typeParam None - this function has no generic type parameters.
 */
export function parseGoWorkUses (goWork: string): string[] {
  const uses: string[] = []
  let inBlock = false
  for (const raw of goWork.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (line === '') {
      continue
    }
    if (inBlock) {
      if (line.startsWith(')')) {
        inBlock = false
      } else {
        uses.push(unquote(line))
      }
    } else if (/^use\s*\(/.test(line)) {
      inBlock = true
      const rest = line.replace(/^use\s*\(/, '').trim()
      if (rest !== '' && !rest.startsWith(')')) {
        uses.push(unquote(rest))
      }
    } else if (/^use\s+\S/.test(line)) {
      uses.push(unquote(line.replace(/^use\s+/, '')))
    }
  }

  return [...new Set(uses)]
}

/**
 * Removes the quotes Go allows around a path.
 *
 * @param path - A path as written in a `go.work`.
 * @returns The path without surrounding quotes.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function unquote (path: string): string {
  return path.replaceAll(/^["'`]|["'`]$/g, '')
}
