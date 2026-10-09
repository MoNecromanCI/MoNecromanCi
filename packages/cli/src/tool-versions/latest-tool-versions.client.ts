import { tmpdir } from 'node:os'
import { versionParts } from './compare-tool-versions.algorithm'

/**
 * What the queries need from outside.
 *
 * @remarks
 * Both are parameters so a test needs no network and no tools.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ToolQueryDependencies {
  /** GETs a URL and returns the body, or `undefined` when it cannot be reached. */
  fetchText: (url: string) => Promise<string | undefined>
  /** Runs a command and returns what it printed, or `undefined` when it failed or is not installed. */
  capture:   (command: string, arguments_: string[]) => Promise<string | undefined>
}

/**
 * A tool mnci pins, and how to ask its own release source for the newest release.
 *
 * @remarks
 * The name is how {@link TOOL_QUERIES} and the pins are matched, and what the report prints.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ToolQuery {
  readonly name:   string
  readonly latest: (dependencies: ToolQueryDependencies) => Promise<string | undefined>
}

/**
 * Parses JSON text.
 *
 * @param text - JSON, or `undefined`.
 * @returns The value, or `undefined` when there is no text or it is not JSON.
 * @throws Never - unreadable text is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
function parseJson (text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * The highest of a set of version strings, compared as numbers.
 *
 * @param versions - Version strings of any form {@link versionParts} reads.
 * @returns The highest, as written, or `undefined` when none is readable.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function highest (versions: readonly string[]): string | undefined {
  const readable = versions.filter(version => versionParts(version).length > 0)

  return readable.toSorted((a, b) => {
    const left = versionParts(a)
    const right = versionParts(b)
    for (const [index, part] of left.entries()) {
      if ((right[index] ?? 0) !== part) {
        return part - (right[index] ?? 0)
      }
    }

    return 0
  }).at(-1)
}

/**
 * The tools mnci pins, each with the question that finds its newest release.
 *
 * @remarks
 * Each asks the tool's own source, never a copy of it: `go list` for the linter (so a private proxy and the
 * proxy's own idea of "latest" apply), Node's `index.json` for the newest long-term-support release,
 * `go.dev/dl` for Go, the .NET release index for the newest supported channel, and the Flutter repository's tags
 * for the newest stable. Every answer is optional: a tool that is not installed or a source that cannot be reached
 * is simply not reported.
 */
export const TOOL_QUERIES: readonly ToolQuery[] = [
  {
    name:   'golangci-lint',
    latest: async ({ capture }) => {
      // From a directory with no module, so a workspace's go.work cannot change what `@latest` means.
      const output = await capture('go', ['list', '-m', '-json', 'github.com/golangci/golangci-lint/v2@latest'])
      const version = (parseJson(output) as { Version?: unknown } | undefined)?.Version

      return typeof version === 'string' ? version.replace(/^v/u, '') : undefined
    },
  },
  {
    name:   'Node',
    latest: async ({ fetchText }) => {
      const releases = parseJson(await fetchText('https://nodejs.org/dist/index.json')) as Array<{ version?: string, lts?: unknown }> | undefined
      const lts = Array.isArray(releases) ? releases.find(release => release.lts !== false && release.lts !== undefined) : undefined

      return lts?.version?.replace(/^v/u, '')
    },
  },
  {
    name:   'npm',
    latest: async ({ capture }) => {
      const output = await capture('npm', ['view', 'npm', 'version'])

      return output?.trim()
    },
  },
  {
    name:   'Go',
    latest: async ({ fetchText }) => {
      const releases = parseJson(await fetchText('https://go.dev/dl/?mode=json')) as Array<{ version?: string, stable?: boolean }> | undefined
      const stable = Array.isArray(releases) ? releases.find(release => release.stable === true) : undefined

      return stable?.version?.replace(/^go/u, '')
    },
  },
  {
    name:   '.NET SDK',
    latest: async ({ fetchText }) => {
      const index = parseJson(await fetchText('https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json')) as { 'releases-index'?: Array<Record<string, unknown>> } | undefined
      const supported = (index?.['releases-index'] ?? []).filter(channel => channel['support-phase'] === 'active')

      return highest(supported.map(channel => String(channel['channel-version'] ?? '')))
    },
  },
  {
    name:   'Flutter SDK',
    latest: async ({ capture }) => {
      const output = await capture('git', ['ls-remote', '--tags', '--refs', 'https://github.com/flutter/flutter.git'])
      const tags = (output ?? '').split('\n').map(line => /refs\/tags\/(\d+\.\d+\.\d+)$/u.exec(line)?.[1]).filter((tag): tag is string => tag !== undefined)

      return highest(tags)
    },
  },
]

/**
 * Where a `capture` should run so that module-aware commands see no workspace.
 *
 * @remarks
 * `go list -m <module>@latest` inside a workspace with a `go.work` is answered in workspace mode, which is not
 * the question being asked, so queries run from a directory with no module at all.
 *
 * @param None - this function takes no parameters.
 * @returns The operating system's temporary directory.
 * @throws Never - always available.
 * @typeParam None - this function has no generic type parameters.
 */
export function neutralDirectory (): string {
  return tmpdir()
}
