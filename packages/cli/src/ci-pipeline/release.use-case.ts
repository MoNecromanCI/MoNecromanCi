import { existsSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCapture, runShell } from '../nx-workspace'
import {
  GO_RELEASE_TAG,
  VSCODE_EXTENSION_TAG,
  nugetFeedUrl,
  pythonPublishUrl,
  readMnciConfig,
  type RegistryConfig,
} from '../workspace-overlay'
import { detectCiHost, groupEnd, groupStart } from './ci-environment.client'
import type { CiDependencies, CiProcesses } from './phase.contract'

/** How many releasable projects of each ecosystem the workspace has. */
interface ReleasableCounts {
  npm:    number
  python: number
  csharp: number
  dart:   number
  vscode: number
  go:     number
}

/** The valid shapes of `RELEASE_SPECIFIER`: a bump keyword or an exact semver. */
const SPECIFIER = /^(?:major|minor|patch|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

/**
 * Whether a manifest at `relativePath` carries `tag` in its tags array.
 *
 * @remarks
 * `apps/*` projects are tagged two ways: a `package.json` keeps its tags under
 * `nx.tags` (a TypeScript-solution project, e.g. a vscode-extension), a
 * `project.json` under a top-level `tags` (a Go app). A malformed manifest
 * counts as untagged rather than throwing, so a half-written file cannot change
 * the release scope.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param relativePath - The manifest's workspace-relative path.
 * @param tag - The tag to look for.
 * @returns `true` when the manifest declares the tag.
 * @throws Never - a malformed manifest counts as untagged.
 * @typeParam None - this function has no generic type parameters.
 */
function hasTag (workspaceRoot: string, relativePath: string, tag: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(workspaceRoot, relativePath), 'utf8')) as {
      tags?: unknown
      nx?:   { tags?: unknown }
    }
    const tags = relativePath.endsWith('project.json') ? parsed.tags : parsed.nx?.tags

    return Array.isArray(tags) && tags.includes(tag)
  } catch {
    return false
  }
}

/**
 * Counts the releasable projects of each ecosystem, the way the inline guard does.
 *
 * @remarks
 * Matches `release.projects` in the generated `nx.json`: npm/C#/Dart publishable
 * packages under `packages/*`, Python under `python-packages/*`, and the two
 * `apps/*` kinds that release by tag (a vscode-extension, a `--release` Go app).
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The per-ecosystem counts.
 * @throws Never - only globs and reads manifests, each failure-tolerant.
 * @typeParam None - this function has no generic type parameters.
 */
function releasableCounts (workspaceRoot: string): ReleasableCounts {
  return {
    npm:    globSync('packages/*/package.json', { cwd: workspaceRoot }).length,
    csharp: globSync('packages/*/*.csproj', { cwd: workspaceRoot }).length,
    python: globSync('python-packages/*/pyproject.toml', { cwd: workspaceRoot }).length,
    dart:   globSync('packages/*/pubspec.yaml', { cwd: workspaceRoot }).length,
    vscode: globSync('apps/*/package.json', { cwd: workspaceRoot }).filter(path => hasTag(workspaceRoot, path, VSCODE_EXTENSION_TAG)).length,
    go:     globSync('apps/*/project.json', { cwd: workspaceRoot }).filter(path => hasTag(workspaceRoot, path, GO_RELEASE_TAG)).length,
  }
}

/**
 * Refuses to release from a shallow clone, where tag resolution silently lies.
 *
 * @remarks
 * `nx release` resolves each package's current version from its git tag and, when
 * it cannot find one, falls back to the stale on-disk version — which can propose,
 * and publish, a DOWNGRADE. A shallow clone is exactly where the tag is missing,
 * so this is checked before anything is tagged. An indeterminate result (the `git`
 * call itself failed) is treated as unsafe.
 *
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0 when the clone has full history, 1 otherwise.
 * @throws Never - a failing `git` call is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function shallowCloneGuard (processes: CiProcesses, log: (message: string) => void): number {
  const result = processes.capture('git', ['rev-parse', '--is-shallow-repository'])
  if (result.status !== 0) {
    log('Could not determine whether this checkout has full history (git rev-parse --is-shallow-repository failed) - refusing to release. ' + result.stdout.trim())

    return 1
  }
  if (result.stdout.trim() === 'true') {
    log('This checkout is a shallow clone. nx release resolves the current version of each package from its git tag, and silently falls back to the permanently-stale on-disk version when a tag cannot be found - which can propose, and publish, a version DOWNGRADE. Fetch full history before releasing - set fetchDepth (Azure) or fetch-depth (GitHub) to 0.')

    return 1
  }

  return 0
}

/**
 * Proves npm will accept this workspace's token before `nx release` tags anything.
 *
 * @remarks
 * Only for a public-npm workspace: an Azure Artifacts feed authenticates `npm`
 * through `.npmrc`/`npmAuthenticate`, not an npm.org automation token, and has no
 * `whoami`. The whole auth path is exercised with `npm whoami`, the cheapest call
 * that does, because a token rejected at publish time arrives AFTER the tags are
 * pushed. A workspace with no npm packages is a clean skip.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param registryKind - The workspace's registry kind.
 * @param environment - The environment to read `NODE_AUTH_TOKEN` from.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0 when auth is proven or not applicable, 1 when it is missing or rejected.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function npmPreflight (
  workspaceRoot: string,
  registryKind: RegistryConfig['kind'],
  environment: NodeJS.ProcessEnv,
  processes: CiProcesses,
  log: (message: string) => void,
): number {
  if (registryKind !== 'npm' || globSync('packages/*/package.json', { cwd: workspaceRoot }).length === 0) {
    return 0
  }
  if (!environment.NODE_AUTH_TOKEN) {
    log('NPM_TOKEN is empty or unset, so the publish would fail AFTER nx release has already tagged. Add it as a repository secret named exactly NPM_TOKEN - under Actions, not the Dependabot or Codespaces tab, and not an Environment secret. Use an npm Automation token - a Publish token is refused by 2FA in CI.')

    return 1
  }
  const whoami = processes.capture('npm', ['whoami', '--registry=https://registry.npmjs.org/'])
  if (whoami.status !== 0) {
    log('NPM_TOKEN is set but the registry rejected it - ' + whoami.stdout.trim() + '. Check that it has not expired and that it grants publish rights on this scope.')

    return 1
  }
  log('npm auth OK as ' + whoami.stdout.trim())

  return 0
}

/**
 * Checks the PyPI token's shape, and notes which projects a release would create.
 *
 * @remarks
 * Only for a public-npm workspace with Python packages (an Azure feed takes the
 * same PAT it already uses). PyPI has no `whoami` and its only authenticating
 * endpoint answers `405` for good, bad and absent tokens alike, so the cheap
 * failing check is the token's SHAPE — every PyPI token begins `pypi-`. The
 * remaining hazard is new-PROJECT creation, which PyPI rate-limits per account: a
 * `429` arrives after the tags are pushed, stranding those versions. So it names
 * the projects this release would create (a `404` on PyPI), as a NOTE that never
 * fails — a first publish must create the project, and PyPI may be unreachable.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param registryKind - The workspace's registry kind.
 * @param environment - The environment to read `PYPI_TOKEN` from.
 * @param log - The logger.
 * @param fetchStatus - Returns an HTTP status for a URL; injected for testability.
 * @returns 0 when the token is present and well-shaped (or not applicable), 1 otherwise.
 * @throws Never - an unreachable PyPI is logged, not thrown.
 * @typeParam None - this function has no generic type parameters.
 */
async function pypiPreflight (
  workspaceRoot: string,
  registryKind: RegistryConfig['kind'],
  environment: NodeJS.ProcessEnv,
  log: (message: string) => void,
  fetchStatus: (url: string) => Promise<number>,
): Promise<number> {
  const files = globSync('python-packages/*/pyproject.toml', { cwd: workspaceRoot })
  if (registryKind !== 'npm' || files.length === 0) {
    return 0
  }
  if (!environment.PYPI_TOKEN) {
    log('PYPI_TOKEN is empty or unset, so the publish would fail AFTER nx release has already tagged. Add it as a repository secret named exactly PYPI_TOKEN - under Actions, not the Dependabot or Codespaces tab, and not an Environment secret.')

    return 1
  }
  if (!environment.PYPI_TOKEN.startsWith('pypi-')) {
    log('PYPI_TOKEN does not look like a PyPI API token - every one of them begins with pypi-. A password or a truncated paste is rejected only at upload time, which is AFTER nx release has tagged.')

    return 1
  }

  const names = files.map((file) => {
    const text = readFileSync(join(workspaceRoot, file), 'utf8')
    const block = text.slice(text.indexOf('[project]'))
    const line = block.split('\n').find(entry => entry.trimStart().startsWith('name'))

    return line ? line.split('=', 2)[1].replaceAll(/[^\w.-]/gi, '') : ''
  }).filter(Boolean)

  const fresh: string[] = []
  for (const name of names) {
    try {
      const status = await fetchStatus('https://pypi.org/pypi/' + name.toLowerCase().replaceAll(/[-_.]+/g, '-') + '/json')
      if (status === 404) {
        fresh.push(name)
      }
    } catch {
      log('Could not reach PyPI to check ' + name + ' - continuing.')
    }
  }
  if (fresh.length > 0) {
    log('NOTE - this release may CREATE ' + fresh.length + ' new PyPI project(s) - ' + fresh.join(', ') + '. Project creation is rate limited per account, and a 429 there arrives AFTER nx release has tagged - leaving those versions tagged with nothing published, and skipped forever. If that happens, delete the tags for the versions that did not publish before releasing again.')
  }

  return 0
}

/**
 * Sets the publish credentials `nx release` needs, onto the environment.
 *
 * @remarks
 * A faithful port of the overlay's `pythonPublishEnvFragment`/
 * `nugetPublishEnvFragment`, deriving the same URLs from the same
 * {@link RegistryConfig}. An Azure feed is multi-protocol: one base64 PAT serves
 * Python (`TWINE_*`) and NuGet (`NUGET_PAT`); public npm uses a `pypi-` token
 * under `__token__`. A missing credential is a fail-fast here, before tagging,
 * never a silent empty string decoded at publish time.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param registry - The resolved registry config.
 * @param counts - The releasable-project counts.
 * @param environment - The environment to set the credentials on.
 * @param log - The logger.
 * @returns 0 when every needed credential is present, 1 when one is missing.
 * @throws Never - a missing credential is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function applyPublishCredentials (
  workspaceRoot: string,
  registry: RegistryConfig,
  counts: ReleasableCounts,
  environment: NodeJS.ProcessEnv,
  log: (message: string) => void,
): number {
  const pythonUrl = pythonPublishUrl(registry)
  const nugetUrl = nugetFeedUrl(registry)

  if (counts.python > 0) {
    if (pythonUrl !== undefined) {
      if (!environment.PAT) {
        log('This workspace has ' + counts.python + ' Python package(s) to publish to Azure Artifacts but PAT is empty. Add your base64-encoded Azure DevOps PAT as a secret named PAT, or remove the Python packages from release.projects.')

        return 1
      }
      environment.TWINE_REPOSITORY_URL = pythonUrl
      environment.TWINE_USERNAME = 'AzureArtifacts'
      environment.TWINE_PASSWORD = Buffer.from(environment.PAT, 'base64').toString()
    } else if (registry.kind === 'npm') {
      // The missing-token message already came from pypiPreflight; here it only
      // wires the credential twine reads.
      environment.TWINE_USERNAME = '__token__'
      environment.TWINE_PASSWORD = environment.PYPI_TOKEN
      environment.TWINE_NON_INTERACTIVE = '1'
    }
  }

  if (nugetUrl !== undefined && counts.csharp > 0) {
    if (!environment.PAT) {
      log('This workspace has ' + counts.csharp + ' C# package(s) to publish to Azure Artifacts but PAT is empty. Add your base64-encoded Azure DevOps PAT as a secret named PAT, or remove the C# packages from release.projects.')

      return 1
    }
    environment.NUGET_PAT = Buffer.from(environment.PAT, 'base64').toString()
  }

  return 0
}

/**
 * Runs `nx release`, after validating `RELEASE_SPECIFIER` and wiring publish creds.
 *
 * @remarks
 * Skips cleanly when nothing is releasable (`nx release` hard-errors on an empty
 * scope). A bump keyword (`minor`) against more than one releasable package is
 * rejected: nx computes the dependency-bump pass from a stale cached version, so
 * a keyword under-bumps interdependent packages — an exact version is required
 * there. #283 is the per-commit override within the otherwise-automatic,
 * conventional-commit versioning.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param registry - The resolved registry config.
 * @param counts - The releasable-project counts.
 * @param environment - The environment, mutated with publish credentials.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns The release command's status, 0 on a clean skip, or 1 on a bad specifier / missing credential.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function runReleaseCommand (
  workspaceRoot: string,
  registry: RegistryConfig,
  counts: ReleasableCounts,
  environment: NodeJS.ProcessEnv,
  processes: CiProcesses,
  log: (message: string) => void,
): number {
  const total = counts.npm + counts.python + counts.csharp + counts.dart + counts.vscode + counts.go
  if (total === 0) {
    log('Nothing to release - skipping.')

    return 0
  }

  const specifier = environment.RELEASE_SPECIFIER ?? ''
  const extra: string[] = []
  if (specifier !== '') {
    if (!SPECIFIER.test(specifier)) {
      log("RELEASE_SPECIFIER value '" + specifier + "' is invalid - use major, minor, patch, or an exact version like 1.2.3.")

      return 1
    }
    if (/^(?:major|minor|patch)$/.test(specifier) && total > 1) {
      log("RELEASE_SPECIFIER is a keyword ('" + specifier + "') but this workspace has " + total + ' releasable packages - a keyword under-bumps interdependent packages, because nx computes the dependency-bump pass from a stale cached version. Set RELEASE_SPECIFIER to an exact version instead, or clear it.')

      return 1
    }
    extra.push(specifier)
  }

  const credentials = applyPublishCredentials(workspaceRoot, registry, counts, environment, log)
  if (credentials !== 0) {
    return credentials
  }

  return processes.run('npx', ['nx', 'release', ...extra, '--yes'])
}

/**
 * What follows a successful `nx release`: the Go zips, then the tags.
 *
 * @remarks
 * Both are steps the generated pipelines run after the release step, now part of the
 * phase (#259 folds into `release`). A releasable Go app is versioned by its git tag, so its
 * per-platform zips are built and attached to the GitHub Release only now, after tagging,
 * by `tools/go-app-release.cjs` (a workspace without a releasable Go app has no such file and
 * skips it). Tags are pushed explicitly: `nx release`'s own push only runs when a remote
 * GitHub/GitLab Release is configured, which the pipelines never do, so it would never push
 * the tag just created. The push is unconditional (a no-op when nothing released) and comes
 * last, so a failed asset upload leaves the tags unpushed, as the separate steps did.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @returns 0 when both steps passed or were skipped, otherwise the failing step's status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
function afterRelease (workspaceRoot: string, processes: CiProcesses): number {
  if (existsSync(join(workspaceRoot, 'tools', 'go-app-release.cjs'))) {
    const assets = processes.run('node', ['tools/go-app-release.cjs', 'assets'])
    if (assets !== 0) {
      return assets
    }
  }

  return processes.run('git', ['push', 'origin', '--tags'])
}

/**
 * Runs the release phase: preflights, then `nx release` (version + tag + publish), then the Go zips and the tag push.
 *
 * @remarks
 * A port of the inline release guards the generated pipelines carry, run in the
 * same order and reading the workspace's registry from the persisted `nx.json`
 * `mnci` block (the same source `mnci upgrade` reads) rather than from values
 * baked into the YAML at generation time. The sequence, each a fail-fast BEFORE
 * any tag is pushed: refuse a shallow clone, prove npm auth, check the PyPI token
 * and note new projects, then validate the specifier, wire publish credentials
 * and release. `release` is a choosable, main-only action (#269): a workspace
 * that publishes nothing simply never calls it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The environment, process runner, logger and fetch; real ones by default.
 * @returns The exit status: 0 on a successful release or a clean skip, otherwise the first failing step's.
 * @throws Never - a command that fails is a status, not an exception.
 * @typeParam None - this function has no generic type parameters.
 */
export async function runRelease (workspaceRoot: string, dependencies: Partial<CiDependencies> = {}): Promise<number> {
  const environment = dependencies.environment ?? process.env
  const processes = dependencies.processes ?? {
    run:     (command, arguments_) => runShell(command, arguments_, workspaceRoot),
    capture: (command, arguments_) => runCapture(command, arguments_, workspaceRoot),
  }
  const log = dependencies.log ?? ((message: string) => { console.log(message) })
  const fetchStatus = dependencies.fetchStatus ?? (async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })

    return response.status
  })
  const host = detectCiHost(environment)
  const registry: RegistryConfig = readMnciConfig(workspaceRoot).registry ?? { kind: 'npm' }

  log(groupStart(host, 'Release'))
  const close = (status: number): number => {
    const closing = groupEnd(host)
    if (closing !== undefined) {
      log(closing)
    }

    return status
  }

  const shallow = shallowCloneGuard(processes, log)
  if (shallow !== 0) {
    return close(shallow)
  }
  const npm = npmPreflight(workspaceRoot, registry.kind, environment, processes, log)
  if (npm !== 0) {
    return close(npm)
  }
  const pypi = await pypiPreflight(workspaceRoot, registry.kind, environment, log, fetchStatus)
  if (pypi !== 0) {
    return close(pypi)
  }

  const released = runReleaseCommand(workspaceRoot, registry, releasableCounts(workspaceRoot), environment, processes, log)
  if (released !== 0) {
    return close(released)
  }

  return close(afterRelease(workspaceRoot, processes))
}
