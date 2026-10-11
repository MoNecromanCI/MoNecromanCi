import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The source extensions an npm project imports packages from. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro'])

/** Folders that hold what a build or an install produced, never what the team wrote. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'out-tsc', 'coverage', '.astro', '.angular', '.nx', '.git'])

/**
 * Reads a folder's entries, or none when it cannot be read.
 *
 * @param directory - Absolute path to the folder.
 * @returns Its entries with their types.
 * @throws Never - an unreadable folder reads as empty.
 * @typeParam None - this function has no generic type parameters.
 */
function entriesOf (directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Lists the source files under a folder, leaving out what a build or an install produced.
 *
 * @param directory - Absolute path to the folder.
 * @returns Absolute paths of the files whose extension is a source one.
 * @throws Never - an unreadable folder reads as empty.
 * @typeParam None - this function has no generic type parameters.
 */
function sourceFilesUnder (directory: string): string[] {
  return entriesOf(directory).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name) ? [] : sourceFilesUnder(path)
    }
    const dot = entry.name.lastIndexOf('.')

    return dot !== -1 && SOURCE_EXTENSIONS.has(entry.name.slice(dot)) ? [path] : []
  })
}

/**
 * Reads a file as text, or an empty string when it cannot be read.
 *
 * @param path - Absolute path to the file.
 * @returns Its text.
 * @throws Never - an unreadable file reads as empty.
 * @typeParam None - this function has no generic type parameters.
 */
function textOf (path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Lists the source files of a project that still import a package.
 *
 * @remarks
 * Run after `mnci uninstall` removed the declaration, to warn about code that will no longer resolve. It reads the
 * project's own source files and looks for the package as a module specifier (`from 'pkg'`, `import('pkg')`,
 * `require('pkg')`, with or without a subpath). It is a text search, not a parse, so a specifier built at runtime is not
 * found; that is why the caller warns and never fails.
 *
 * @param projectDirectory - Absolute path to the project.
 * @param packageName - The package that was removed.
 * @returns The files that import it, relative to the project, sorted.
 * @throws Never - an unreadable folder or file is skipped.
 * @typeParam None - this function has no generic type parameters.
 */
export function findPackageImports (projectDirectory: string, packageName: string): string[] {
  const escaped = packageName.replaceAll(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`)
  const specifier = new RegExp(String.raw`(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]${escaped}(?:/[^'"]*)?['"]`)

  return sourceFilesUnder(projectDirectory)
    .filter(path => specifier.test(textOf(path)))
    .map(path => relative(projectDirectory, path).split(sep).join('/'))
    .sort((left, right) => left.localeCompare(right))
}
