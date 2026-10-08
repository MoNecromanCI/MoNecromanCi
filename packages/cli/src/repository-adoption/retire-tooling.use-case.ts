import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { RETIRED_FORMATTER_FILES, removeLocalRegistryScaffolding, withoutRetiredFormatterDependencies } from '../workspace-overlay'

/** A script command that calls a formatter or linter mnci retired. */
const RETIRED_COMMAND = /\b(?:prettier|oxfmt|oxlint)\b/

/**
 * Removes the tooling mnci has retired from a repository's root, and says what it removed.
 *
 * @remarks
 * The formatter configs, the retired formatters and linters from the root dependencies, the root scripts
 * that call them (a `format:check` running `oxfmt` fails the moment the dependency is gone), and the
 * local-registry scaffolding (`.verdaccio`, the `verdaccio` dependency and the `local-registry` target).
 * Reuses the overlay's own definitions, so adoption and `mnci upgrade` retire exactly the same things.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @returns A line per removal, for the report.
 * @throws Error when the root `package.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function retireTooling (repositoryRoot: string): string[] {
  const removed: string[] = []
  for (const file of RETIRED_FORMATTER_FILES) {
    if (!fileExists(join(repositoryRoot, file))) {
      continue
    }

    rmSync(join(repositoryRoot, file), { force: true })
    removed.push(file)
  }
  const hadRegistry = fileExists(join(repositoryRoot, '.verdaccio'))
  removeLocalRegistryScaffolding(repositoryRoot)
  if (hadRegistry) {
    removed.push('.verdaccio, its dependency and the local-registry target')
  }

  const manifestPath = join(repositoryRoot, 'package.json')
  if (!fileExists(manifestPath)) {
    return removed
  }
  const manifest = readJson<{ dependencies?: Record<string, string>, devDependencies?: Record<string, string>, scripts?: Record<string, string> } & Record<string, unknown>>(manifestPath)
  for (const key of ['dependencies', 'devDependencies'] as const) {
    const before = manifest[key]
    if (before === undefined) {
      continue
    }
    const after = withoutRetiredFormatterDependencies(before)
    const kept = new Set(Object.keys(after))
    const dropped = Object.keys(before).filter(name => !kept.has(name))
    removed.push(...dropped.map(name => `${key}: ${name}`))
    manifest[key] = after
  }
  const scripts = Object.entries(manifest.scripts ?? {})
  for (const [name, command] of scripts) {
    if (!RETIRED_COMMAND.test(command)) {
      continue
    }

    Reflect.deleteProperty(manifest.scripts as Record<string, string>, name)
    removed.push(`script: ${name} (${command})`)
  }
  writeFileEnsured(manifestPath, toJson(manifest))

  return removed
}
