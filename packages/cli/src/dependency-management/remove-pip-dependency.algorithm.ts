import { parseRequirement } from './manifest.repository'

/**
 * Normalises a Python distribution name the way PEP 503 does, so `Foo_Bar`, `foo.bar` and `foo-bar` are one name.
 *
 * @param name - A requirement's name.
 * @returns The lowercase name with each run of `-`, `_` and `.` as one `-`.
 * @throws Never - pure string work.
 * @typeParam None - this function has no generic type parameters.
 */
function normalisedName (name: string): string {
  return name.toLowerCase().replaceAll(/[-_.]+/g, '-')
}

/**
 * Whether one quoted requirement string of a `dependencies` array names the package.
 *
 * @param entry - The text between the quotes, such as `requests>=2`.
 * @param name - The package name to look for.
 * @returns True when the requirement's name is the package, by PEP 503 normalisation.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function namesPackage (entry: string, name: string): boolean {
  const parsed = parseRequirement(entry)

  return parsed !== undefined && normalisedName(parsed.name) === normalisedName(name)
}

/**
 * Removes one dependency from a `pyproject.toml`'s `[project].dependencies`, the counterpart of `addPipDependency`.
 *
 * @remarks
 * Done on the text, minimally, as the add is: pip has no "remove from pyproject" command, and a TOML round trip would
 * reformat the file. Handles the two shapes the scaffold and teams write, a one-line array and a multi-line one with one
 * requirement per line. A requirement matches by its distribution name (PEP 503), so `requests` removes
 * `requests>=2.31` and `Requests[socks]` alike. Anything outside `[project]`, such as optional dependencies, is left as
 * it is.
 *
 * @param content - The text of `pyproject.toml`.
 * @param name - The package to remove.
 * @returns The text without the requirement; the same text when it was not declared.
 * @throws Never - string surgery only.
 * @typeParam None - this function has no generic type parameters.
 */
export function removePipDependency (content: string, name: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  let inProjectTable = false

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (trimmed.startsWith('[')) {
      inProjectTable = trimmed === '[project]'
      continue
    }
    if (!inProjectTable) {
      continue
    }
    const opener = /^(\s*)dependencies\s*=\s*\[(.*)$/.exec(lines[index])
    if (!opener) {
      continue
    }
    const [, indent, rest] = opener
    if (rest.includes(']')) {
      const inner = rest.slice(0, rest.lastIndexOf(']'))
      const entries = Array.from(inner.matchAll(/"([^"]*)"|'([^']*)'/g), match => match[1] ?? match[2])
      const kept = entries.filter(entry => !namesPackage(entry, name))
      if (kept.length === entries.length) {
        return content
      }
      lines[index] = `${indent}dependencies = [${kept.map(entry => `"${entry}"`).join(', ')}]`

      return lines.join(newline)
    }
    // A multi-line array: drop the element lines that name the package, up to the closing bracket.
    let end = index + 1
    while (end < lines.length && !lines[end].trimStart().startsWith(']')) {
      end++
    }
    const kept = lines.filter((line, position) => {
      if (position <= index || position >= end) {
        return true
      }
      const quoted = /"([^"]*)"|'([^']*)'/.exec(line)

      return quoted === null || !namesPackage(quoted[1] ?? quoted[2], name)
    })

    return kept.length === lines.length ? content : kept.join(newline)
  }

  return content
}
