import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_NATIVE_RUNNERS, type NativeBuildSettings } from './native-build.contract'

/** A Debian package name: lowercase letters, digits and `+ . -`, never starting with a dash. */
const PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]*$/

/** A runner label or VM image: letters, digits and `. _ -`. */
const RUNNER_NAME = /^[A-Z0-9][\w.-]*$/i

/**
 * Reads the native build settings from the `mnci` block of `nx.json`.
 *
 * @remarks
 * Every entry is validated, because the values end up as arguments of `apt-get` and as a runner
 * label in YAML. A package name that could be read as an option (`-o…`) or contain a space is
 * dropped and reported, never passed on.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The settings with defaults filled in, and the problems found.
 * @throws Never - an unreadable or absent `nx.json` reads as the defaults.
 * @typeParam None - this function has no generic type parameters.
 */
export function readNativeBuildConfig (workspaceRoot: string): NativeBuildSettings {
  const settings: NativeBuildSettings = {
    config:   { linuxPackages: [], runners: [...DEFAULT_NATIVE_RUNNERS] },
    problems: [],
  }
  const raw = readNativeEntry(workspaceRoot)
  if (raw === undefined) {
    return settings
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    settings.problems.push('mnci.native must be an object')

    return settings
  }
  const entry = raw as Record<string, unknown>
  const packages = validList(entry.linuxPackages, 'mnci.native.linuxPackages', PACKAGE_NAME, settings.problems)
  const runners = validList(entry.runners, 'mnci.native.runners', RUNNER_NAME, settings.problems)
  if (packages !== undefined) {
    settings.config.linuxPackages = packages
  }
  if (runners !== undefined && runners.length > 0) {
    settings.config.runners = runners
  }

  return settings
}

/**
 * The raw `native` entry of the `mnci` block, or `undefined` when there is none.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The entry as written.
 * @throws Never - an unreadable `nx.json` has no entry.
 * @typeParam None - this function has no generic type parameters.
 */
function readNativeEntry (workspaceRoot: string): unknown {
  const path = join(workspaceRoot, 'nx.json')
  if (!existsSync(path)) {
    return undefined
  }
  try {
    const nxJson = JSON.parse(readFileSync(path, 'utf8')) as { mnci?: { native?: unknown } }

    return nxJson.mnci?.native
  } catch {
    return undefined
  }
}

/**
 * Keeps the entries of a list that match a pattern, and says which did not.
 *
 * @param value - The value found in `nx.json`.
 * @param label - Its dotted path, for the message.
 * @param pattern - What a valid entry looks like.
 * @param problems - Receives one line per problem.
 * @returns The valid entries, or `undefined` when the value is absent or not a list.
 * @throws Never - bad input becomes a problem.
 * @typeParam None - this function has no generic type parameters.
 */
function validList (value: unknown, label: string, pattern: RegExp, problems: string[]): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    problems.push(`${label} must be a list of strings`)

    return undefined
  }
  const valid: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && pattern.test(item)) {
      valid.push(item)
    } else {
      problems.push(`${label} has an invalid entry: ${JSON.stringify(item)}`)
    }
  }

  return valid
}
