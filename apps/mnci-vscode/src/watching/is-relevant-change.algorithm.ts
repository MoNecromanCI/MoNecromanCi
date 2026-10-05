/** Files whose change can alter the list of projects or what mnci reports about them. */
const MANIFESTS: ReadonlySet<string> = new Set(['nx.json', 'project.json', 'package.json', 'go.mod', 'go.work', 'pyproject.toml', 'pubspec.yaml'])

/** Folders that hold dependencies or build output, where manifests change constantly and mean nothing. */
const IGNORED_FOLDERS = /(?:^|[\\/])(?:node_modules|dist|\.nx|\.git|\.dart_tool|bin|obj|build|out-tsc|\.venv|venv|vendor)[\\/]/

/**
 * Whether a changed file should make the extension re-read the CLI's answers.
 *
 * @remarks
 * Manifests only (`nx.json`, `project.json`, `package.json`, `go.mod`, `pyproject.toml`,
 * `pubspec.yaml`, any `.csproj`), and never inside dependency or output folders: an
 * `npm install` rewrites hundreds of `package.json` files under `node_modules`.
 *
 * @param path - The changed file's path, with either separator.
 * @returns `true` when the change is worth a refresh.
 * @throws Never - pure test.
 * @typeParam None - this function has no generic type parameters.
 */
export function isRelevantChange (path: string): boolean {
  if (IGNORED_FOLDERS.test(path)) {
    return false
  }
  const name = path.split(/[\\/]/).pop() ?? ''

  return MANIFESTS.has(name) || name.endsWith('.csproj')
}
