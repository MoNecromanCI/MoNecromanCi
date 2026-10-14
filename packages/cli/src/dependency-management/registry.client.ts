import { pool, runCaptureAsync } from '../nx-workspace'
import type { Ecosystem } from './manifest.repository'
import { newestStableComposerVersion } from './composer-requirements.algorithm'
import { newestGemVersion } from './gemfile-gems.algorithm'
import { mavenMetadataUrl, newestMavenRelease } from './maven-metadata.algorithm'

/**
 * How many registry lookups run at once.
 *
 * @remarks
 * Each one is a process, not a socket, so the ceiling is about file descriptors
 * and CPU rather than politeness to the registry. Eight keeps a hundred-package
 * workspace under ten seconds without saturating a two-core CI agent.
 */
const LOOKUP_CONCURRENCY = 8

/**
 * Latest published version per package name.
 *
 * @remarks
 * A package the registry does not know is simply absent from the map rather
 * than present with an empty value, so a caller reads "no answer" and "no
 * update" the same way — as nothing to offer.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type LatestVersions = Map<string, string>

/**
 * Asks npm for the latest published version of each package.
 *
 * @remarks
 * `npm view` per package rather than a raw HTTPS request to
 * `registry.npmjs.org`, and that is the load-bearing choice in this file.
 * mnci generates workspaces that publish to **Azure Artifacts**, where the feed
 * is reached through a scoped `@scope:registry` line and authenticated with
 * Basic credentials from the workspace `.npmrc`. `npm view` resolves both for
 * free. Hand-rolling that is how the `_authToken`-as-Bearer trap gets walked
 * into a second time: Azure Artifacts answers a PAT sent as a Bearer token with
 * a 401, and only Basic auth works — a distinction npm already knows about and
 * this command has no business re-implementing.
 *
 * `npm outdated --json` was rejected for a different reason: it is
 * workspace-shallow and omits any package whose declared range already covers
 * the latest release, so the patch/minor/major grouping built on it would be
 * silently incomplete.
 *
 * @param names - The package names to look up.
 * @param cwd - The workspace root, so npm reads the workspace `.npmrc`.
 * @returns A promise of the latest version per package that answered.
 * @throws Never - a package the registry does not know is simply absent.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestNpmVersions (
  names: readonly string[],
  cwd: string,
): Promise<LatestVersions> {
  const results = await pool(names, LOOKUP_CONCURRENCY, async name => {
    const result = await runCaptureAsync('npm', ['view', name, 'version', '--json'], cwd)
    if (result.status !== 0) {
      return
    }
    try {
      // `--json` yields a quoted string for a single field, and an array when
      // the spec matched several versions; the last is the newest.
      const parsed: unknown = JSON.parse(result.stdout)
      const version = Array.isArray(parsed) ? (parsed.at(-1) as unknown) : parsed

      return typeof version === 'string' ? ([name, version] as const) : undefined
    } catch {
      return
    }
  })

  return new Map(results.filter(entry => entry !== undefined))
}

/**
 * Asks PyPI (or whichever index pip is configured for) for latest versions.
 *
 * @remarks
 * `pip index versions` is the same call `@mnci/nx-python-pip`'s `VersionActions`
 * already makes to resolve a published version, reused here rather than hitting
 * `pypi.org/pypi/<name>/json` directly for the same reason npm goes through
 * `npm view`: a workspace may be pointed at a private index, and pip's own
 * configuration is the only thing that knows.
 *
 * The command is marked experimental by pip and prints a warning saying so —
 * on stderr, which {@link runCaptureAsync} discards.
 *
 * @param names - The package names to look up.
 * @param cwd - The workspace root.
 * @returns A promise of the latest version per package that answered.
 * @throws Never - an unavailable index yields an empty map.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestPipVersions (
  names: readonly string[],
  cwd: string,
): Promise<LatestVersions> {
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const results = await pool(names, LOOKUP_CONCURRENCY, async name => {
    const result = await runCaptureAsync(python, ['-m', 'pip', 'index', 'versions', name], cwd)
    if (result.status !== 0) {
      return
    }
    // First line is `<name> (<latest>)`; the second lists every version.
    const match = /\(([^)]+)\)/.exec(result.stdout)

    return match ? ([name, match[1]] as const) : undefined
  })

  return new Map(results.filter(entry => entry !== undefined))
}

/**
 * Asks the Go toolchain which required modules have a newer release.
 *
 * @remarks
 * One call for the whole module graph, because `go list` already reports the
 * available update per module in its `Update` field — there is no per-package
 * query to pool. `-json` emits a stream of concatenated objects rather than a
 * JSON array, so the output is split on the object boundary before parsing.
 *
 * @param cwd - The workspace root, which holds the single `go.mod`.
 * @returns A promise of the latest version per module with an update.
 * @throws Never - an absent Go toolchain yields an empty map.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestGoVersions (cwd: string): Promise<LatestVersions> {
  const result = await runCaptureAsync('go', ['list', '-m', '-u', '-json', 'all'], cwd)
  if (result.status !== 0) {
    return new Map()
  }

  const latest: LatestVersions = new Map()
  for (const chunk of result.stdout.split(/^\}\s*$/m)) {
    const text = `${chunk.trim()}${chunk.trim() ? '}' : ''}`
    if (!text.startsWith('{')) {
      continue
    }
    try {
      const module_ = JSON.parse(text) as { Path?: string, Update?: { Version?: string } }
      if (module_.Path && module_.Update?.Version) {
        latest.set(module_.Path, module_.Update.Version)
      }
    } catch {
      // A partial chunk at the tail of the stream is not an error worth raising.
    }
  }

  return latest
}

/**
 * Asks pub which workspace dependencies have a newer release.
 *
 * @remarks
 * One call, like Go: `flutter pub outdated --json` reports the whole pub
 * workspace in a single pass, which is what a shared `pubspec.lock` means.
 *
 * `latest` is read rather than `resolvable`: `resolvable` is capped by every
 * other constraint in the workspace, so reporting it would hide exactly the
 * upgrades a user runs this command to discover.
 *
 * @param cwd - The workspace root, which holds the root `pubspec.yaml`.
 * @returns A promise of the latest version per package.
 * @throws Never - an absent Flutter SDK yields an empty map.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestPubVersions (cwd: string): Promise<LatestVersions> {
  const result = await runCaptureAsync('flutter', ['pub', 'outdated', '--json'], cwd)
  if (result.status !== 0) {
    return new Map()
  }

  try {
    const report = JSON.parse(result.stdout) as {
      packages?: Array<{ package?: string, latest?: { version?: string } }>
    }
    const latest: LatestVersions = new Map()
    const packages = report.packages ?? []
    for (const entry of packages) {
      if (entry.package && entry.latest?.version) {
        latest.set(entry.package, entry.latest.version)
      }
    }

    return latest
  } catch {
    return new Map()
  }
}

/**
 * Asks NuGet for the latest published version of each package.
 *
 * @remarks
 * `dotnet package search <name> --exact-match --format json` per package —
 * the same "go through the ecosystem's own tool" reasoning as `npm view`:
 * with no `--source` argument, it consults every source in the workspace's
 * resolved `nuget.config` (public nuget.org, and an Azure Artifacts feed
 * when one is configured), the same way `npm view` reads the resolved
 * `.npmrc`. Verified against Microsoft's own `dotnet package search` docs —
 * not assumed — including the exact JSON shape read below
 * (`searchResult[].packages[].latestVersion`) and that the command needs SDK
 * 8.0.2xx+, well under the SDK version mnci pins (`DOTNET_SDK_VERSION` in
 * `overlay.ts`).
 *
 * `--exact-match` still returns the package under `searchResult[].packages`,
 * so the result is matched by `id` (case-insensitively — NuGet package IDs
 * are case-preserving but not case-sensitive) rather than assumed to be the
 * only entry, in case a source ever returns more than one hit.
 *
 * @param names - The package names to look up.
 * @param cwd - The workspace root, so `dotnet` reads the workspace `nuget.config`.
 * @returns A promise of the latest version per package that answered.
 * @throws Never - a package no configured source knows is simply absent.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestNugetVersions (
  names: readonly string[],
  cwd: string,
): Promise<LatestVersions> {
  const results = await pool(names, LOOKUP_CONCURRENCY, async name => {
    const result = await runCaptureAsync(
      'dotnet',
      ['package', 'search', name, '--exact-match', '--format', 'json'],
      cwd,
    )
    if (result.status !== 0) {
      return
    }
    try {
      const parsed = JSON.parse(result.stdout) as {
        searchResult?: Array<{ packages?: Array<{ id?: string, latestVersion?: string }> }>
      }
      const packages = parsed.searchResult?.flatMap(source => source.packages ?? []) ?? []
      const match =
        packages.find(entry => entry.id?.toLowerCase() === name.toLowerCase()) ?? packages[0]

      return match?.latestVersion ? ([name, match.latestVersion] as const) : undefined
    } catch {
      return
    }
  })

  return new Map(results.filter(entry => entry !== undefined))
}

/**
 * Asks crates.io for the latest published version of each crate.
 *
 * @remarks
 * `cargo search <name> --limit 5` per crate, through the ecosystem's own tool as the others are, so a configured
 * registry source is consulted. The result is matched by exact name, since a search returns near matches too: `serde`
 * is not answered with `serde_json`.
 *
 * @param names - The crate names to look up.
 * @param cwd - The workspace root, so `cargo` reads the workspace's `.cargo/config.toml`.
 * @returns A promise of the latest version per crate that answered.
 * @throws Never - an unknown crate, or no `cargo`, is simply absent.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestCargoVersions (
  names: readonly string[],
  cwd: string,
): Promise<LatestVersions> {
  const results = await pool(names, LOOKUP_CONCURRENCY, async name => {
    const result = await runCaptureAsync('cargo', ['search', name, '--limit', '5'], cwd)
    if (result.status !== 0) {
      return
    }
    const line = result.stdout.split(/\r?\n/).find(entry => entry.startsWith(`${name} = "`))
    const version = line === undefined ? undefined : /^\S+ = "([^"]+)"/.exec(line)?.[1]

    return version === undefined ? undefined : ([name, version] as const)
  })

  return new Map(results.filter(entry => entry !== undefined))
}

/**
 * Asks Packagist, through `composer show`, for the newest stable release of each package.
 *
 * @remarks
 * `composer show --all --format=json <package>` per package, through the ecosystem's own tool as the others are, so a
 * repository configured in the workspace is consulted. A development branch or pre-release is never offered.
 *
 * @param names - The `vendor/package` names to look up.
 * @param cwd - The workspace root.
 * @returns A promise of the newest stable version per package that answered.
 * @throws Never - an unknown package, or no `composer`, is simply absent.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestComposerVersions (
  names: readonly string[],
  cwd: string,
): Promise<LatestVersions> {
  const results = await pool(names, LOOKUP_CONCURRENCY, async name => {
    const result = await runCaptureAsync('composer', ['show', '--all', '--format=json', '--no-interaction', name], cwd)
    const version = result.status === 0 ? newestStableComposerVersion(result.stdout) : undefined

    return version === undefined ? undefined : ([name, version] as const)
  })

  return new Map(results.filter(entry => entry !== undefined))
}

/**
 * Asks RubyGems, through `gem list --remote`, for the newest release of each gem.
 *
 * @remarks
 * `gem list --remote --exact <gem>` per gem, so a configured source is consulted; pre-releases are not listed.
 *
 * @param names - The gem names to look up.
 * @param cwd - The workspace root.
 * @returns A promise of the newest version per gem that answered.
 * @throws Never - an unknown gem, or no `gem`, is simply absent.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestGemVersions (
  names: readonly string[],
  cwd: string,
): Promise<LatestVersions> {
  const results = await pool(names, LOOKUP_CONCURRENCY, async name => {
    const result = await runCaptureAsync('gem', ['list', '--remote', '--exact', name], cwd)
    const version = result.status === 0 ? newestGemVersion(result.stdout, name) : undefined

    return version === undefined ? undefined : ([name, version] as const)
  })

  return new Map(results.filter(entry => entry !== undefined))
}

/** The repositories asked for a Maven artifact's metadata, in order: the one most libraries are in, then Google's (AndroidX). */
const MAVEN_REPOSITORIES = ['https://repo.maven.apache.org/maven2', 'https://dl.google.com/dl/android/maven2']

/**
 * Asks Maven Central, then Google's Maven repository, for the newest release of each artifact.
 *
 * @remarks
 * Read from each artifact's `maven-metadata.xml`, which is what Maven and Gradle themselves consult. A private repository
 * named in `settings.xml` or a build file is not read: an artifact that lives only there is absent, and `up` offers nothing
 * for it rather than guessing. The metadata prefers a stable release over a pre-release (see {@link newestMavenRelease}).
 *
 * @param names - The artifacts as `group:artifact`.
 * @returns A promise of the newest release per artifact that answered.
 * @throws Never - an unknown artifact or an unreachable repository is simply absent.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestMavenVersions (names: readonly string[]): Promise<LatestVersions> {
  const results = await pool(names, LOOKUP_CONCURRENCY, async name => {
    for (const repository of MAVEN_REPOSITORIES) {
      const url = mavenMetadataUrl(repository, name)
      if (url === undefined) {
        return
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        const version = response.ok ? newestMavenRelease(await response.text()) : undefined
        if (version !== undefined) {
          return [name, version] as const
        }
      } catch {
        // An unreachable repository is asked no further for this artifact.
      }
    }

    return
  })

  return new Map(results.filter(entry => entry !== undefined))
}

/**
 * Resolves latest versions for one ecosystem.
 *
 * @remarks
 * The single entry point commands use, so the per-ecosystem asymmetry — two
 * ecosystems answer per package, two answer for the whole graph at once — stays
 * behind one signature instead of leaking into every caller.
 *
 * @param ecosystem - Which ecosystem to query.
 * @param names - The package names, used only by the per-package ecosystems.
 * @param cwd - The workspace root.
 * @returns A promise of the latest version per package that answered.
 * @throws Never - an unavailable toolchain yields an empty map.
 * @typeParam None - this function has no generic type parameters.
 */
export async function latestVersions (
  ecosystem: Ecosystem,
  names: readonly string[],
  cwd: string,
): Promise<LatestVersions> {
  switch (ecosystem) {
    case 'npm': {
      return await latestNpmVersions(names, cwd)
    }
    case 'pip': {
      return await latestPipVersions(names, cwd)
    }
    case 'nuget': {
      return await latestNugetVersions(names, cwd)
    }
    case 'cargo': {
      return await latestCargoVersions(names, cwd)
    }
    // A CMake project declares no registry dependency yet (#473), so there is nothing to ask a registry.
    case 'cmake': {
      return new Map()
    }
    // Both ask Maven Central and Google's repository: a Gradle catalog names Maven coordinates too.
    case 'maven':
    case 'gradle': {
      return await latestMavenVersions(names)
    }
    case 'composer': {
      return await latestComposerVersions(names, cwd)
    }
    case 'bundler': {
      return await latestGemVersions(names, cwd)
    }
    case 'go': {
      return await latestGoVersions(cwd)
    }
    // 'pub' explicitly, not a default: a future ecosystem added to the union
    // without a case here should fail to compile, not silently resolve as
    // Dart/Flutter's whole-graph query — exactly the trap this switch would
    // otherwise have laid for 'nuget' itself.
    case 'pub': {
      return await latestPubVersions(cwd)
    }
  }
}
