import { existsSync, globSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  fileExists,
  markExecutable,
  readCodeWorkspace,
  readJson,
  toJson,
  writeFileEnsured,
} from '../file-system'
import { DEFAULT_NATIVE_RUNNERS, readNativeBuildConfig } from '../native-build-config'
import { mergePipeline, phaseEnd, phaseStart, slotMarkers } from '../pipeline-customization'

/**
 * Where a generated monorepo publishes its npm packages.
 *
 * @remarks
 * Supports Azure Artifacts and the public npm registry. GitHub Packages is
 * out of scope for this cut.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type RegistryConfig =
  | { kind: 'azure-artifacts'; organization: string; project: string; artifactsFeed: string } |
  { kind: 'npm' }

/**
 * Which CI provider(s) {@link applyOverlay} writes a pipeline file for.
 *
 * @remarks
 * `azure` (the default) writes only `azure-pipelines.yml`; `github` writes
 * only `.github/workflows/ci.yml`; `both` writes both — so a GitHub-hosted
 * repo can pick the provider it actually runs on instead of carrying an
 * unused Azure Pipelines file.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type CiProvider = 'azure' | 'github' | 'both'

/**
 * The stack chosen at `mnci new` — asked up front, honoured by every `add`.
 *
 * @remarks
 * TypeScript is not a knob: every workspace runs the **dual compiler**
 * ({@link TS_COMPILER_DEPENDENCIES}) — TypeScript 6 for the programmatic API
 * (Nx's graph/plugins, Vite, typescript-eslint, the editor) and TypeScript 7's
 * native `tsc` for the `typecheck`/`build` tasks. The only stack knob is the
 * unit-test runner, persisted as Nx **generator defaults** in `nx.json`.
 * Linting AND formatting are ESLint (always) — there is no separate formatter.
 *
 * @typeParam None - this type has no generic type parameters.
 */
/**
 * The parts of the toolchain a user chooses at `mnci new`.
 *
 * @remarks
 * Two knobs, deliberately. Everything else in an mnci workspace is fixed by the
 * `--preset=ts` premise, and each additional choice multiplies the matrix the
 * e2e has to cover — so a knob earns its place only when neither answer is
 * defensible for everyone. The test runner qualifies (Jest and Vitest are both
 * first-class in Nx) and so does the linter, now that the Rust toolchain is a
 * real alternative rather than an experiment.
 *
 * Persisted into `nx.json`'s `mnci` block, so `mnci upgrade` re-applies the
 * overlay for the stack the workspace actually chose instead of reverting it to
 * the defaults.
 */
export interface StackConfig {
  /** Unit-test runner (both Nx-native for the plugin kinds). */
  testRunner: 'jest' | 'vitest'
}

/**
 * The `--yes` / flagless defaults — the current opinionated stack.
 *
 * @remarks
 * Jest: the test runner existing generated repos (and the e2e suite)
 * already assume, so defaulting to it keeps behaviour unchanged when
 * the stack is not chosen explicitly. Linting and formatting are always ESLint.
 */
export const DEFAULT_STACK: StackConfig = { testRunner: 'jest' }

/**
 * The dual TypeScript compiler stamped into every workspace's `devDependencies`.
 *
 * @remarks
 * TypeScript 7 is the native (Go) compiler: much faster, but it ships no
 * programmatic API yet, so tools that import `typescript` (Nx's
 * `@nx/js/typescript` plugin and project graph, Vite, typescript-eslint, the
 * editor language service) still need TypeScript 6. The
 * [Nx TS 7 guide](https://nx.dev/docs/technologies/typescript/guides/typescript-7)
 * solves this with two npm aliases: `typescript` resolves to a TS 6 package
 * (API intact, and its binary is `tsc6`, not `tsc`), while `@typescript/native`
 * provides the TS 7 `tsc`. The `@nx/js/typescript` plugin's inferred
 * `typecheck`/`build` tasks then run `tsc` = TS 7, while Nx analyses config
 * through the TS 6 API — automatically, with no target rewiring. Frozen per
 * repo by the committed lockfile, so `npm ci` reproduces it.
 */
export const TS_COMPILER_DEPENDENCIES: Record<string, string> = {
  '@typescript/native': 'npm:typescript@^7.0.2',
  'typescript':         'npm:@typescript/typescript6@^6.0.2',
}

/**
 * How an Azure Artifacts workspace authenticates npm against its feed.
 *
 * @remarks
 * - `pat` — a base64 personal access token from the pipeline's variable group,
 *   read by the root `.npmrc`'s `username`/`_password` block. The default, and the
 *   only mode that works on every CI provider.
 * - `build-identity` — `npmAuthenticate@0` injects the build service identity's
 *   token into `.npmrc` at build time, so the file carries **no credentials** and
 *   there is no PAT to store, encode, rotate or let expire. Azure Pipelines only:
 *   GitHub Actions has no equivalent task.
 *
 * The two are not interchangeable spellings of one thing. The feed's publish
 * endpoint advertises a Bearer scheme bound to `login.windows.net`, which wants an
 * **Entra ID access token**; a PAT is not one and is rejected as Bearer. A PAT
 * therefore has to go through Basic (`_password`), while the build identity's
 * token is Entra-issued and is what Bearer wants. See {@link npmrcContent}.
 */
export type NpmAuthMode = 'pat' | 'build-identity'

/**
 * The auth modes, for validating a flag value.
 *
 * @remarks
 * One list, so the flag's error message and the validator cannot disagree about
 * what is accepted.
 */
export const NPM_AUTH_MODES: readonly NpmAuthMode[] = ['pat', 'build-identity']

/**
 * Resolves the npm auth mode a workspace should be written with, or refuses one
 * its CI cannot deliver.
 *
 * @remarks
 * `build-identity` is `npmAuthenticate@0`, an Azure Pipelines task: GitHub Actions
 * has nothing equivalent, so a workspace whose CI includes GitHub would be written
 * a credential-free `.npmrc` that authenticates nowhere on that provider. That is
 * refused up front rather than generated, because the failure it would cause -
 * a publish rejected as an authentication error - names neither the mode nor the
 * flag. `--ci=both` has no single right answer, so it is refused too rather than
 * guessed at.
 *
 * It also only means anything for an Azure Artifacts feed: public npm has no
 * identity for the task to borrow.
 *
 * @param requested - The `--npm-auth` flag value, if one was passed.
 * @param registry - The workspace's registry.
 * @param ci - The workspace's CI provider(s).
 * @param fallback - What to use when no flag was passed: the persisted value, or
 * the mode detected in an existing pipeline.
 * @returns The mode to write, or `undefined` when none was requested anywhere -
 * which leaves the workspace on the default.
 * @throws Error when the flag is not a known mode, or when `build-identity` is
 * requested for a registry or CI provider that cannot use it.
 * @typeParam None - this function has no generic type parameters.
 */
export function resolveNpmAuth (
  requested: string | undefined,
  registry: RegistryConfig,
  ci: CiProvider,
  fallback?: NpmAuthMode,
): NpmAuthMode | undefined {
  if (requested !== undefined && !NPM_AUTH_MODES.includes(requested as NpmAuthMode)) {
    throw new Error(`--npm-auth must be one of: ${NPM_AUTH_MODES.join(', ')} (got '${requested}').`)
  }
  const mode = (requested as NpmAuthMode | undefined) ?? fallback
  if (mode !== 'build-identity') {
    return mode
  }
  if (registry.kind !== 'azure-artifacts') {
    throw new Error(
      '--npm-auth build-identity needs an Azure Artifacts feed: public npm has no build identity to borrow. Use --registry azure-artifacts, or drop the flag.',
    )
  }
  if (ci !== 'azure') {
    throw new Error(
      `--npm-auth build-identity needs --ci azure (this workspace is '${ci}'): it is npmAuthenticate@0, an Azure Pipelines task, and GitHub Actions has no equivalent. Use --npm-auth pat, or drop the GitHub pipeline.`,
    )
  }

  return mode
}

/**
 * Returns the npm registry URL for a registry config.
 *
 * @remarks
 * Public npm needs no scoped registry, so it returns `undefined`.
 *
 * @param registry - The monorepo's resolved registry configuration.
 * @returns The registry URL, or `undefined` for the public npm registry.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function registryUrl (registry: RegistryConfig): string | undefined {
  if (registry.kind === 'azure-artifacts') {
    return `https://pkgs.dev.azure.com/${registry.organization}/${registry.project}/_packaging/${registry.artifactsFeed}/npm/registry/`
  }

  return undefined
}

/**
 * Builds the `.npmrc` body for a registry configuration.
 *
 * @remarks
 * The two registry kinds get deliberately **different** files, because the honest
 * answer differs. This replaced a comment-only placeholder that left
 * `npm publish` unable to authenticate in every generated workspace, while the CI
 * dutifully exported a token nothing consumed.
 *
 * **Azure Artifacts: scope routing plus auth.** `@<scope>:registry` sends both
 * resolution *and* `npm publish` of `@<scope>/*` to the feed, because npm prefers
 * a scope's registry over the global one when publishing a scoped package. That
 * makes it real protection — a package named `@<scope>/x` cannot reach npmjs.org
 * by accident. Verified against a real registry rather than read from docs: npm
 * reports `Publishing to <feed>` with only the scope line set.
 *
 * Only the scope is routed, and that is a choice. A global `registry=` would send
 * every install through the feed too, so `npm ci` would need feed auth just to
 * fetch public packages — verified: with only the scope routed, installing a
 * public dependency still succeeds with no token present at all.
 *
 * **Public npm: auth only, no scope routing.** npmjs.org is already the default
 * registry, so a `@<scope>:registry` line pointing there changes nothing — and
 * calling it protection against an accidental public publish would be false,
 * since the public registry *is* the intended target. That specific false claim
 * is why this function is worth reading twice: an earlier version of this file
 * asserted exactly that safety property in the README while emitting no routing
 * line at all, and `overlay.test.ts` asserted the line's absence. Do not
 * reintroduce a protection that the configuration cannot provide.
 *
 * **The one PAT, two encodings.** `_password` takes the base64 value Azure
 * Artifacts' own "Connect to feed" instructions hand you, so it is used as-is.
 * `twine` wants the *raw* token and the release guard decodes it there
 * ({@link releaseGuard}). Easy to get backwards; check before wiring a third
 * protocol.
 *
 * An unset `${PAT}`/`${NODE_AUTH_TOKEN}` does not break anything locally —
 * verified that `npm install` of a public dependency still succeeds with the
 * variable absent, so a developer needs no token to work in the workspace.
 *
 * **Build identity: routing only.** With {@link NpmAuthMode} `build-identity` the
 * Azure file carries the scope line and no credentials at all. `npmAuthenticate@0`
 * appends the build identity's Entra token to it in the pipeline (the generated
 * `azure-pipelines.yml` runs it before `npm ci`). The trade is stated in the file
 * rather than discovered: a developer no longer inherits a credential from it, so
 * a local authenticated command needs `npx vsts-npm-auth -config .npmrc` on
 * Windows or a hand-added entry. Public npm ignores the mode — there is nothing to
 * inject.
 *
 * @param registry - The monorepo's resolved registry configuration.
 * @param scope - The npm scope (e.g. `@demo`), used for the routing line.
 * @param npmAuth - How npm authenticates against an Azure Artifacts feed.
 * @returns The full text of the generated `.npmrc`.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function npmrcContent (
  registry: RegistryConfig,
  scope: string,
  npmAuth: NpmAuthMode = 'pat',
): string {
  if (registry.kind === 'npm') {
    return `; Publish authentication for the public npm registry.
;
; NODE_AUTH_TOKEN is exported by the generated CI's release step. Nothing needs
; it for day-to-day work here - installing, building and testing never
; authenticate.
;
; It is NOT harmless the moment you DO want to authenticate from this directory,
; which an earlier version of this comment claimed. A project .npmrc wins over
; your user one, so with NODE_AUTH_TOKEN unset this line hands npm an empty
; token and overrides 'npm login': inside this repo 'npm whoami' fails with a
; 401 and any write is refused. The refusal is easy to misread, because for a
; scoped package the registry answers a write you are not allowed to make with
;
;   npm error 404 Not Found - PUT https://registry.npmjs.org/@scope%2fthing
;
; and everything above it is npm listing what it intended to send, so a long
; healthy-looking run still changes nothing.
;
; To publish or deprecate by hand, run it from outside this directory, or export
; a real token first.
//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}

; There is deliberately NO '${scope}:registry' line here. npmjs.org is already
; the default registry, so routing the scope to it would change nothing — and
; presenting that as protection against an accidental public publish would be
; false, because the public registry is the intended target. (An earlier version
; of this file made exactly that claim while emitting no routing line at all.)
; To keep a scoped package off npmjs.org, use a private feed: generate with
; --registry azure-artifacts, which does route the scope.
`
  }

  const feedUrl = registryUrl(registry) as string
  if (npmAuth === 'build-identity') {
    return `; Publish + resolution routing for this workspace's own scope.
;
; '${scope}:registry' sends BOTH resolution and 'npm publish' of ${scope}/* to the
; feed: npm prefers a scope's registry over the global one when publishing a
; scoped package, so a ${scope}/* package cannot reach npmjs.org by accident.
;
; Only the scope is routed, on purpose. A global 'registry=' would send every
; install through the feed as well, so 'npm ci' would need feed auth just to fetch
; public packages.
${scope}:registry=${feedUrl}

; NO credentials are written here. The 'npmAuthenticate@0' task in
; azure-pipelines.yml injects them into this file at build time, using the build
; service identity - so there is no PAT to store, rotate or encode.
;
; That is forced by what the feed accepts. An unauthenticated PUT to the publish
; endpoint answers with:
;   www-authenticate: Bearer authorization_uri=https://login.windows.net/<tenant>,
;                     Basic realm="...", TFS-Federated
; so its Bearer scheme wants an ENTRA ID access token, which is what the task
; supplies. A PAT is not one: npm sends _authToken verbatim as a Bearer header, so
; a PAT there is rejected with "Unable to authenticate, your authentication token
; seems to be invalid". A PAT can only authenticate through the Basic scheme
; (username + base64 _password), which is what 'mnci upgrade --npm-auth pat' writes.
;
; The cost is local: nothing in this file authenticates a developer's machine, so
; publishing or installing a private package by hand needs
; 'npx vsts-npm-auth -config .npmrc' (Windows) or a credential you add yourself.
; Building and testing never authenticate.
`
  }

  // npm keys per-registry credentials by the URL with the protocol stripped.
  const feedKey = feedUrl.replace(/^https:/, '')
  // npm matches credentials by URL prefix and walks only UP the path, so an entry
  // on '/npm/registry/' is never found for a request to '/npm/'. Both are keyed.
  const feedShortKey = feedKey.replace('npm/registry/', 'npm/')

  return `; Publish + resolution routing for this workspace's own scope.
;
; '${scope}:registry' sends BOTH resolution and 'npm publish' of ${scope}/* to the
; feed: npm prefers a scope's registry over the global one when publishing a
; scoped package, so a ${scope}/* package cannot reach npmjs.org by accident.
;
; Only the scope is routed, on purpose. A global 'registry=' would send every
; install through the feed as well, so 'npm ci' would need feed auth just to fetch
; public packages.
${scope}:registry=${feedUrl}

; Feed credentials. PAT is the BASE64 value Azure Artifacts' "Connect to feed"
; instructions give you, which is exactly what _password expects, so it is used
; as-is. (twine wants the RAW token; the CI release step decodes it there.)
; Azure ignores the username, and npm requires an email it never uses.
;
; NOT _authToken, and that is measured rather than assumed. The feed answers an
; unauthenticated PUT to the publish endpoint with:
;   www-authenticate: Bearer authorization_uri=https://login.windows.net/<tenant>,
;                     Basic realm="...", TFS-Federated
; so its Bearer scheme wants an Entra ID access token, NOT a PAT. npm sends
; _authToken verbatim as a Bearer header, so a PAT there is rejected with
; "Unable to authenticate, your authentication token seems to be invalid". A PAT
; authenticates through the Basic scheme, which is username/_password. Note the
; Packaging REST API DOES accept a PAT as Bearer - do not generalise from it.
;
; Both path forms are keyed because npm walks only UP a URL when matching.
${feedKey}:username=AzureArtifacts
${feedKey}:_password=\${PAT}
${feedKey}:email=npm-requires-this-and-never-uses-it
${feedShortKey}:username=AzureArtifacts
${feedShortKey}:_password=\${PAT}
${feedShortKey}:email=npm-requires-this-and-never-uses-it
`
}

/**
 * The Nx tag a `vscode-extension` project carries, and what `release.projects` matches it by.
 *
 * @remarks
 * An extension lives in `apps/`, which no release glob covers, and a path added to
 * `release.projects` by hand would be lost on the next `mnci upgrade`, which
 * rewrites the array (#229). A tag matcher needs no array merging: every upgrade
 * writes the same list, and it matches every extension there will ever be.
 */
export const VSCODE_EXTENSION_TAG = 'type:vscode-extension'

/**
 * The Nx tag a releasable `go-app` carries, and what `release.projects` matches it by.
 *
 * @remarks
 * A separate tag from `type:go-app`, not a reuse of it: most Go apps are internal
 * tools and must stay unreleased, so releasing is an opt-in
 * (`mnci add go-app <name> --release`). Matched by tag for the reason
 * {@link VSCODE_EXTENSION_TAG} is: an app lives in `apps/`, which no release glob
 * covers, and the array is rewritten on every `mnci upgrade`.
 */
export const GO_RELEASE_TAG = 'release:go'

/**
 * The Nx tag a `go-app` that needs a C toolchain carries (`mnci add go-app <name> --cgo`).
 *
 * @remarks
 * Such an app cannot be cross-compiled from one machine (a tray icon needs Cocoa on
 * macOS and GTK on Linux), so it is built on a runner of each OS by a separate CI
 * job, and kept out of the single-agent verify. The tag is what both are keyed on.
 */
export const GO_CGO_TAG = 'build:cgo'

/**
 * Whether the workspace has an app that needs the native CI job.
 *
 * @remarks
 * Read at generation time, not detected by the pipeline at run time, so a workspace
 * without such an app gets a pipeline byte-identical to the one it had before this
 * existed. A job cannot be skipped on a file's existence at the job level on either
 * provider, so the choice has to be made when the file is written.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns True when an `apps/*` project is tagged {@link GO_CGO_TAG}.
 * @throws Never - an unreadable or malformed project file counts as not tagged.
 * @typeParam None - this function has no generic type parameters.
 */
export function hasNativeGoApp (workspaceRoot: string): boolean {
  return globSync('apps/*/project.json', { cwd: workspaceRoot }).some((projectJson) => {
    try {
      const { tags } = JSON.parse(readFileSync(join(workspaceRoot, projectJson), 'utf8')) as { tags?: string[] }

      return (tags ?? []).includes(GO_CGO_TAG)
    } catch {
      return false
    }
  })
}

/**
 * Builds the `release` block merged into a generated workspace's `nx.json`.
 *
 * @remarks
 * The tag-only model: versions are computed from conventional commits since
 * each package's last release tag, the bump is
 * **never committed** (`git.commit: false`) — only the tag is created and
 * pushed — so a protected `main` never rejects a release, and future runs
 * resolve versions from tag names, not from a committed `package.json`.
 * `fallbackCurrentVersionResolver: 'disk'` keeps a brand-new package (no tag
 * yet) from hard-erroring.
 *
 * The git options live under a top-level `git` (not `version.git`): the
 * guarded CI release step and the generated `release:preview` script both run
 * the combined `nx release` command (never the bare `nx release version`
 * subcommand), and Nx hard-errors that combined command when git options are
 * granular (`version.git`/`changelog.git`) instead of top-level — the reverse
 * of the bare `version` subcommand's own requirement, which is why the two
 * forms aren't interchangeable (verified empirically).
 *
 * **GitHub Releases (`ci === 'github'` only).** Verified empirically against
 * the pinned Nx version (23.1.0, real `--dry-run` runs, and the installed
 * `release.js` source) that the combined `nx release` command now tags
 * *before* it pushes — an earlier version of this comment described a bug
 * where Nx's internal push fired before the tag existed, silently losing
 * every tag; that ordering bug no longer reproduces on this pinned version.
 * Nx itself also refuses to enable `createRelease` while `git.push: false`
 * (hard error: "createRelease... cannot be enabled when git push is
 * explicitly disabled"), so `push: true` here is required, not optional, once
 * `createRelease` is on. `changelog.projectChangelogs.file: false` sends the
 * generated changelog content straight into the GitHub Release body without
 * writing an unpushable `CHANGELOG.md` (`git.commit` stays `false`, so a
 * written file would just be silently discarded at the end of every CI run).
 * `workspaceChangelog` stays `false` for every provider: projects release
 * independently (see below), so only per-project changelogs/releases make
 * sense — a single workspace-wide changelog would conflate unrelated
 * packages' histories. `GITHUB_TOKEN` (GitHub Actions' own built-in token,
 * already sufficient under the `contents: write` permission the workflow
 * already grants) is exported in {@link githubActionsYaml}'s release step;
 * once it's pushing anyway, {@link githubActionsYaml} drops its separate
 * explicit `git push origin --tags` step as redundant.
 *
 * **Azure-only and `both`** deliberately keep today's `push: false` /
 * no-`createRelease` behaviour. GitHub Releases only make sense when the repo
 * is actually hosted on GitHub, which `ci` alone cannot confirm for `'azure'`
 * (Azure Pipelines can build a GitHub-hosted repo too) or safely guarantee
 * for `'both'` (both pipeline files exist; whichever one actually executes
 * might be the Azure one, which has no `GITHUB_TOKEN` to give Nx) — so this
 * scope is intentionally limited to the one case where a `GITHUB_TOKEN` is
 * guaranteed to exist: GitHub Actions as the *only* configured provider.
 * {@link azurePipelinesYaml} is unchanged and keeps its own explicit
 * `git push origin --tags` step for exactly this reason.
 *
 * Two directories are released: `packages/*` (publishable **npm** libraries)
 * and `python-packages/*` (publishable **Python** packages) — deliberately one
 * flat project list, not two named `release.groups`: Nx hard-errors
 * `nx release` entirely (every group, not just the empty one) when any
 * explicit group matches zero projects — a real failure mode for a workspace
 * that has added Python packages but no npm ones yet, or vice versa (verified
 * empirically). A flat list has no such all-or-nothing requirement: it stays
 * releasable as soon as *either* glob matches something. Each project's own
 * `versionActions` (npm's default, or `@mnci/nx-python-pip`'s
 * `PythonVersionActions` — stamped onto every publishable Python lib's own
 * `project.json` by that plugin's own `library` generator, not by anything
 * here) reads/writes the right manifest (`package.json` vs `pyproject.toml`)
 * — project-level config wins over the group's, so both kinds coexist in the
 * one group correctly. Publishable **Flutter/Dart** packages also live in
 * `packages/*` and are covered by the same flat list;
 * `@mnci/nx-flutter`'s own `library` generator stamps its
 * `DartVersionActions` on for `pubspec.yaml`.
 * Internal libraries live in `libs/` and apps in `apps/`, so release scoping
 * needs no tags for them.
 *
 * `!tag:type:go-lib` is the one exception, and it is a **bug fix**, not
 * fine-tuning. A `go-lib` also lands in `packages/`, but it has no
 * per-project manifest at all — mnci puts every Go project in one root
 * `go.mod` — so Nx falls back to its default `versionActions`, looks for a
 * `packages/<name>/package.json` that does not exist, and aborts. Because
 * that happens while building the release graph, it takes down the release of
 * **every** project in the workspace, not just the Go one: before this
 * exclusion, a single `mnci add go-lib` made `nx release` exit 1 for the
 * whole repo (verified empirically, then re-verified green with the
 * exclusion in place).
 *
 * Excluding rather than teaching Go a `versionActions` is the semantically
 * correct fix: in a single-module layout there is exactly one Go module, so
 * its packages have no independent versions to bump: a consumer running
 * `go get` on one of them resolves against the *module's* tag, so a
 * per-project version would be a fiction. Go's "publishing" is that
 * repo-level tag, which is not a per-project release concern.
 *
 * A `go-app` is the opposite case, and is released only when it opts in: an
 * executable has its own version, the one its users download. `tag:release:go`
 * selects it, and the app's own `project.json` carries the version config that
 * keeps Nx from looking for a `package.json` (see `GO_RELEASE_SCRIPT`), so it
 * does not reintroduce the abort `go-lib` hit. `!tag:type:go-lib` is unaffected: an
 * app is never tagged `type:go-lib`.
 *
 * @param ci - Which CI provider(s) the workspace generates a pipeline for —
 * only `'github'` (GitHub Actions and nothing else) turns on GitHub Release
 * creation; see the remarks above for why `'azure'` and `'both'` do not.
 * @returns The object to merge onto `nx.json`'s `release` key.
 * @throws Never - builds a plain object with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function releaseConfig (ci: CiProvider): Record<string, unknown> {
  const githubReleases = ci === 'github'

  return {
    projectsRelationship: 'independent',
    projects:             ['packages/*', 'python-packages/*', `tag:${VSCODE_EXTENSION_TAG}`, `tag:${GO_RELEASE_TAG}`, '!tag:type:go-lib'],
    releaseTag:           { pattern: '{projectName}@{version}' },
    git:                  { commit: false, tag: true, push: githubReleases },
    version:              {
      conventionalCommits:              true,
      fallbackCurrentVersionResolver:   'disk',
      // Build only what is being released. Without this, @nx/js:lib's generator
      // defaults the pre-version command to building EVERY project, so a broken
      // (or merely slow) app build would block releasing unrelated packages.
      // Set here at `new` time it wins: the generator only fills this in when
      // absent (it spreads the existing release.version over its default). Both
      // globs are listed; `nx run-many` no-ops cleanly when one matches nothing.
      preVersionCommand:                `npx nx run-many -t build --projects=packages/*,python-packages/*,tag:${VSCODE_EXTENSION_TAG}`,
      // The lock file resync is OFF, and the reason is that it cannot succeed
      // on the one release where it would matter.
      //
      // It is not `preVersionCommand` that does this, despite the name it gets
      // reported under: `@nx/js`'s `afterAllProjectsVersioned` hook shells
      // `npm install --package-lock-only` once every project has been versioned.
      // That command resolves the whole tree against the registry, so the first
      // release of two NEW interdependent packages 404s — package A declares a
      // dependency on package B at the version this very run is about to
      // publish, and B does not exist on the registry yet. Measured on a real
      // workspace releasing `@scope/cli` and `@scope/studio` together.
      //
      // Turning it off costs nothing here, because mnci releases are tag-only:
      // `git.commit` is `false`, so the refreshed lock file is written into an
      // ephemeral CI checkout and then thrown away without ever being committed.
      // It was never protecting anything. That it goes stale is not a new
      // condition either — every manifest on disk is already stale by design for
      // exactly the same reason, which is why `fallbackCurrentVersionResolver`
      // is `'disk'` and why a tagless clone makes a dry run silently wrong.
      //
      // A workspace that DOES want the lock file refreshed should commit the
      // bump too (`git.commit: true`), at which point this can be dropped.
      versionActionsOptions:            { skipLockFileUpdate: true },
      // OFF, because under this tag-only model it can only ever refuse a release.
      //
      // With it on, nx will not release a package whose internal dependency range
      // cannot absorb the bump, and `git.commit: false` means the manifests on disk
      // stay at the scaffold version for ever, so the range is always the one that
      // was written then. Packages start at 0.0.1 and `npm install <pkg> -w <other>`
      // writes `^0.0.1`, which on a 0.0.x version matches that version alone: the
      // first bump to 0.0.2 is outside it, and the release dies in the version phase,
      // before anything is tagged, with lint, typecheck, test and build all green
      // (the release runs on the default branch only, so nothing else ever tries it).
      // Measured on a fresh workspace of two interdependent packages (#345).
      preserveMatchingDependencyRanges: false,
    },
    changelog: githubReleases
      ? {
          workspaceChangelog: false,
          projectChangelogs:  { createRelease: 'github', file: false },
          // A GitHub Release needs a changelog, and a changelog needs a ref to start
          // from. On the first release of a repository there is no tag to start from,
          // and nx release dies after versioning (#243, measured). With this set it
          // starts from the first commit; once a tag exists it is never consulted.
          automaticFromRef:   true,
        }
      : { workspaceChangelog: false },
  } as const
}

/**
 * The `sync` block merged into a generated workspace's `nx.json`.
 *
 * @remarks
 * `--preset=ts` already registers `@nx/js:typescript-sync` on the `build` and
 * `typecheck` targets (via the `@nx/js/typescript` plugin), so Nx already
 * detects a stale TypeScript project reference — e.g. after hand-editing a
 * file to add a new cross-project import — on the next `build`/`typecheck`/
 * `affected` run. Without this block that detection only **prompts**
 * ("Would you like to sync the identified changes?"): easy to miss, and it
 * blocks any non-interactive run. `applyChanges: true` makes Nx fix it
 * silently instead, locally, every time — no more `nx sync` run by hand.
 *
 * This is deliberately safe in CI: per Nx's own docs, a non-interactive run
 * (CI) always runs sync generators in dry-run mode and **fails** instead of
 * applying, regardless of this setting — so a forgotten local sync still
 * surfaces as a clear CI failure ({@link azurePipelinesYaml}'s explicit
 * `nx sync:check` step gives that failure early and unambiguously) rather
 * than silently patching an ephemeral CI checkout that never gets committed.
 */
export const SYNC_CONFIG = { applyChanges: true } as const

/**
 * The `@nx/eslint/plugin` registration merged into a generated workspace's `nx.json`.
 *
 * @remarks
 * This plugin is what gives every project its `lint` target: it maps ESLint
 * config *directories* onto the project roots beneath them, so the single root
 * config mnci writes covers the whole workspace and no project needs one of its
 * own.
 *
 * mnci registers it because mnci owns linting. Nx would otherwise add it as a
 * side effect of the first `nx g … --linter=eslint`, which is both invisible
 * and no longer true: the generators are invoked with `--linter=none` (see
 * `add/shared.ts`), precisely so they stop scaffolding a per-project config —
 * and, more pressingly, stop dragging in `eslint-plugin-import@2.31.0`, whose
 * peer range caps at ESLint 9 and made `mnci add react-app` fail outright on
 * the ESLint 10 toolchain this workspace installs.
 *
 * A consequence worth stating: `npm run lint` now works in a workspace with
 * zero projects, which it previously did only by accident.
 */
export const ESLINT_PLUGIN_CONFIG = {
  plugin:  '@nx/eslint/plugin',
  options: { targetName: 'lint' },
} as const

/**
 * The plugin name of an `nx.json` `plugins` entry.
 *
 * @remarks
 * Nx accepts both the bare-string form (`"@nx/eslint/plugin"`) and the object
 * form (`{ plugin, options }`), and a real workspace can hold a mix.
 *
 * @param entry - One element of `nx.json`'s `plugins` array.
 * @returns The plugin name, or `undefined` for an entry in neither form.
 * @throws Never - pure property read.
 * @typeParam None - this function has no generic type parameters.
 */
function pluginName (entry: unknown): string | undefined {
  return typeof entry === 'string' ? entry : (entry as { plugin?: string }).plugin
}

/**
 * Returns a copy of an `nx.json` object with `@nx/eslint/plugin` registered.
 *
 * @remarks
 * Idempotent, so `mnci upgrade` cannot accumulate duplicate entries — and a
 * workspace where Nx already added the plugin (generated before this existed)
 * keeps its own entry, options included, rather than having them overwritten.
 *
 * @param nxJson - The parsed `nx.json`.
 * @returns A new object whose `plugins` array contains the ESLint plugin.
 * @throws Never - performs a pure object merge with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function withEslintPlugin (nxJson: Record<string, unknown>): Record<string, unknown> {
  const plugins = (nxJson.plugins as unknown[] | undefined) ?? []
  const registered = plugins.some(entry => pluginName(entry) === ESLINT_PLUGIN_CONFIG.plugin)

  return registered
    ? { ...nxJson, plugins }
    : { ...nxJson, plugins: [...plugins, ESLINT_PLUGIN_CONFIG] }
}

/**
 * The workspace-wide files every project's verification depends on.
 *
 * @remarks
 * `nx affected` walks the project graph, and a root config file is in no
 * project — so without this, changing one marks only the root pseudo-project,
 * which has no `lint`/`typecheck`/`test`/`build` target. Measured on a real
 * workspace before the fix: a PR touching `tsconfig.base.json` alone verified
 * **nothing at all** and reported green.
 *
 * Each entry is a file that can change every project's result:
 * `eslint.config.mjs` is the whole linting opinion, `tsconfig.base.json` is
 * what every project's tsconfig extends, and the root `package.json` holds
 * every devDependency version and the curated scripts.
 *
 * BOTH ESLint files are listed. `eslint.config.mnci.mjs` carries every rule and
 * `eslint.config.mjs` is the thin file that imports it and holds the
 * workspace's own blocks — either can change every project's result, and
 * listing only one would make a change to the other invisible to
 * `nx affected`, which is the exact failure this input exists to prevent.
 *
 * No formatter config is listed because none exists: ESLint is the formatter,
 * and `eslint.config.mjs` is already the first entry. When Prettier owned
 * formatting, `.prettierrc.json` was excluded on the grounds that
 * `format:check` swept the whole tree on every run regardless, so listing it
 * would invalidate every project's cache and verify nothing new. Both the file
 * and that step are gone. `package-lock.json` is absent too — Nx already
 * marks projects affected from lockfile changes through its external-dependency
 * nodes (verified: a lockfile-only edit marks every project).
 */
export const SHARED_GLOBAL_INPUTS = [
  '{workspaceRoot}/eslint.config.mjs',
  '{workspaceRoot}/eslint.config.mnci.mjs',
  '{workspaceRoot}/tsconfig.base.json',
  '{workspaceRoot}/package.json',
] as const

/**
 * Returns a copy of an `nx.json` object whose `sharedGlobals` named input
 * covers the mnci-owned root config files.
 *
 * @remarks
 * Idempotent and additive: entries a workspace already has are kept in place
 * and never duplicated, so `mnci upgrade` can run repeatedly and a workspace
 * that added its own shared globals does not lose them. `sharedGlobals` is
 * referenced by the preset's `default` input, which `production` extends, so
 * one list reaches every target.
 *
 * @param nxJson - The parsed `nx.json`.
 * @returns A new object whose `namedInputs.sharedGlobals` includes every entry
 * of {@link SHARED_GLOBAL_INPUTS}.
 * @throws Never - performs a pure object merge with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function withSharedGlobals (nxJson: Record<string, unknown>): Record<string, unknown> {
  const namedInputs = (nxJson.namedInputs as Record<string, unknown> | undefined) ?? {}
  const existing = (namedInputs.sharedGlobals as unknown[] | undefined) ?? []
  const missing = SHARED_GLOBAL_INPUTS.filter(entry => !existing.includes(entry))

  return {
    ...nxJson,
    namedInputs: { ...namedInputs, sharedGlobals: [...existing, ...missing] },
  }
}

/**
 * The `nx.json` `plugins` entry for `@mnci/nx-python-pip`'s dependency graph.
 *
 * @remarks
 * A bare string rather than the `{ plugin, options }` form: it takes no
 * options, and the string form is what Nx's own docs show for a plugin that
 * contributes only `createDependencies`.
 */
export const PYTHON_GRAPH_PLUGIN = '@mnci/nx-python-pip/graph'

/**
 * Returns a copy of an `nx.json` object with the Python graph plugin
 * registered, when the workspace actually has the plugin.
 *
 * @remarks
 * The GATE is the point, and it is not a nicety. Nx resolves every entry in
 * `plugins` while constructing the project graph, and a name it cannot resolve
 * is a hard failure - so registering this unconditionally would break every
 * generated workspace that has no Python in it, which is most of them. The
 * plugin arrives only when `mnci add python-*` installs it, so that is the
 * signal this reads.
 *
 * Without the registration the plugin still supplies generators, executors and
 * release actions - those resolve by plain module lookup through
 * `generators.json`/`executors.json` - but contributes NO graph edges, because
 * `createDependencies` is only called for a registered plugin. That is the
 * difference between `nx affected` knowing a Python library's consumers and
 * silently testing none of them.
 *
 * Idempotent and additive, like {@link withEslintPlugin}: a workspace that
 * registered it by hand keeps its own entry, and `mnci upgrade` cannot
 * accumulate duplicates.
 *
 * @param nxJson - The parsed `nx.json`.
 * @param pluginInstalled - Whether the workspace declares
 * `@mnci/nx-python-pip`.
 * @returns A new object, with the plugin registered when it is installed.
 * @throws Never - performs a pure object merge with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function withPythonGraphPlugin (
  nxJson: Record<string, unknown>,
  pluginInstalled: boolean,
): Record<string, unknown> {
  const plugins = (nxJson.plugins as unknown[] | undefined) ?? []
  if (!pluginInstalled || plugins.some(entry => pluginName(entry) === PYTHON_GRAPH_PLUGIN)) {
    return nxJson.plugins === undefined ? nxJson : { ...nxJson, plugins }
  }

  return { ...nxJson, plugins: [...plugins, PYTHON_GRAPH_PLUGIN] }
}

/**
 * Narrows to a mergeable object: not null, and not an array.
 *
 * @remarks
 * Arrays are deliberately NOT mergeable. `release.projects` is mnci's own
 * list, and element-wise merging it would leave a workspace unable to drop an
 * entry mnci once emitted.
 *
 * @param value - The value to test.
 * @returns Whether `value` is a plain object.
 * @throws Never - pure predicate.
 * @typeParam None - this function has no generic type parameters.
 */
function isMergeableObject (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merges mnci's owned config over whatever the workspace already had,
 * so keys mnci does not emit survive.
 *
 * @remarks
 * mnci wins for every key it emits — those encode the tag-only release model,
 * and a workspace silently flipping `git.commit` to `true` would be a worse
 * bug than the one this fixes. Everything else is the workspace's and is kept.
 *
 * The trade, stated: a key mnci USED to emit and no longer does now lingers
 * instead of being cleaned up. That is the right side to err on - a stale key
 * nx ignores costs nothing, and deleting a key the workspace meant to keep has
 * already cost a repo two days of silently failing releases.
 *
 * @param existing - The workspace's current value, of any shape.
 * @param owned - The config mnci generates.
 * @returns The merged object.
 * @throws Never - pure recursive merge.
 * @typeParam None - this function has no generic type parameters.
 */
function preservingUnknownKeys (
  existing: unknown,
  owned: Record<string, unknown>,
): Record<string, unknown> {
  if (!isMergeableObject(existing)) {
    return owned
  }

  const merged: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(owned)) {
    const previous = merged[key]
    merged[key] =
      isMergeableObject(value) && isMergeableObject(previous)
        ? preservingUnknownKeys(previous, value)
        : value
  }

  return merged
}

/**
 * Returns a copy of an `nx.json` object with the release block applied.
 *
 * @remarks
 * Pure read-modify-write on the object the Nx preset generated — this never
 * templates whole config files, it only patches in the one opinion Nx has no
 * default for.
 *
 * The release block is **merged, not replaced**, and that distinction is the
 * whole point. It used to be `release: releaseConfig(ci)`, which meant every
 * `mnci upgrade` deleted any key a workspace had added under `release` — and
 * `release` is the one block a workspace legitimately has to extend, because
 * nx exposes settings there that mnci has no opinion about and cannot
 * enumerate in advance.
 *
 * Observed, not hypothetical. A workspace had deliberately set
 * `version.preserveMatchingDependencyRanges: false` - without it nx REFUSES to
 * release when an internal dependency range cannot absorb the bump, which
 * under this tag-only model is always, since `git.commit` is `false` and the
 * on-disk manifests are permanently the scaffold version. An upgrade dropped
 * it, and every release from that day on failed in the version phase. Nothing
 * else noticed: lint, typecheck, test and build all stayed green, because the
 * only broken path was the release, and that runs on the default branch alone.
 *
 * `sharedGlobals` ({@link withSharedGlobals}) and `plugins`
 * ({@link withEslintPlugin}) were already additive, and `generators`, `sync`
 * and `mnci` are all spread-merged where `nx.json` is written. `release` was
 * the one wholesale replacement, and the only one whose value nests, so a
 * shallow spread would still have wiped `version.*`.
 *
 * @param nxJson - The parsed `nx.json` produced by `create-nx-workspace`.
 * @param ci - Which CI provider(s) the workspace generates a pipeline for —
 * forwarded to {@link releaseConfig} to decide whether GitHub Release
 * creation is turned on.
 * @returns A new object with `release` (and `defaultBase: 'main'`) set.
 * @throws Never - performs a pure object merge with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function withReleaseConfig (
  nxJson: Record<string, unknown>,
  ci: CiProvider,
): Record<string, unknown> {
  return {
    ...nxJson,
    defaultBase: 'main',
    release:     preservingUnknownKeys(nxJson.release, releaseConfig(ci)),
  }
}

/**
 * The commitlint config written into generated workspaces.
 *
 * @remarks
 * Conventional commits are the release mechanism's input, so they are
 * enforced at commit time — the one piece Nx itself does not provide.
 */
export const COMMITLINT_CONFIG = `export default { extends: ['@commitlint/config-conventional'] }
`

/**
 * The husky `commit-msg` hook body that runs commitlint.
 *
 * @remarks
 * `--no` keeps npx from installing anything at commit time — commitlint is a
 * devDependency installed by `mnci new`.
 */
export const COMMIT_MSG_HOOK = `npx --no -- commitlint --edit "$1"
`

/**
 * The `@mnci/eslint-config` version generated workspaces depend on.
 *
 * @remarks
 * NOT a caret range, deliberately — `^` on a pre-1.0 package is minor-locked:
 * `^0.1.0` means `>=0.1.0 <0.2.0`, so `npm update` can never cross into 0.2.0
 * or later. That defeats the one reason this ships as a package rather than a
 * template string in this file: "`npm update` carries lint-rule improvements
 * into existing workspaces without an `mnci upgrade`" was never actually true
 * under `^0.1.0`. Found in a real generated workspace still declaring
 * `^0.1.0` after 20+ published releases — `mnci upgrade` was also stamping
 * this constant back over any manual bump on every run (see
 * {@link eslintToolchainDependencies}'s call site), so there was no way out
 * except editing the range by hand and never running `mnci upgrade` again.
 *
 * `>=0.1.0 <1.0.0` floats across every 0.x release without an upper bound
 * inside that line, while still requiring an explicit bump of this constant
 * (an intentional `mnci upgrade`-worthy decision) to cross into a stable 1.0.
 */
export const ESLINT_CONFIG_VERSION = '>=0.1.0 <1.0.0'

/**
 * The `@mnci/eslint-config` spec to write into a generated workspace's manifest.
 *
 * @remarks
 * Reads `MNCI_ESLINT_CONFIG_SPEC` so the e2e suite can point this at a local
 * tarball (`npm pack`'d from `packages/eslint-config`) instead of the published
 * registry package — without it, `npm install` in a freshly generated workspace
 * 404s until the package has been released at least once. Same escape hatch
 * `add/python.ts` and `add/flutter.ts` already use for their plugins
 * (`MNCI2_PYTHON_PIP_SPEC`, `MNCI_NX_FLUTTER_SPEC`).
 *
 * {@link ESLINT_CONFIG_VERSION} is the default and the only value a real
 * `mnci new` ever writes.
 *
 * @returns The dependency spec (a semver range, or a path/URL when overridden).
 * @throws Never - reads an environment variable.
 * @typeParam None - this function has no generic type parameters.
 */
export function eslintConfigSpec (): string {
  return process.env.MNCI_ESLINT_CONFIG_SPEC ?? ESLINT_CONFIG_VERSION
}

/**
 * The `@mnci/cli` range generated workspaces depend on, so a pipeline can call `npx mnci ci <phase>`.
 *
 * @remarks
 * A dependency, not an `npx @mnci/cli` fetched on every run: the version is then pinned by the
 * lockfile, Dependabot bumps it like any other dependency, and the pipeline runs the same commands a
 * developer runs locally. A range across the major, like {@link ESLINT_CONFIG_VERSION}, so
 * `npm update` carries improvements in without an `mnci upgrade`; crossing into the next major is a
 * deliberate edit of this constant, made together with whatever that major changes in the pipeline.
 */
export const CLI_VERSION = '>=4.0.0 <5.0.0'

/**
 * The `@mnci/cli` spec to write into a generated workspace's manifest.
 *
 * @remarks
 * Reads `MNCI_CLI_SPEC` so the e2e suite can point this at a local tarball (`npm pack`'d from
 * `packages/cli`) instead of the published package, the same escape hatch as
 * {@link eslintConfigSpec}. {@link CLI_VERSION} is the only value a real `mnci new` ever writes.
 *
 * @param None - this function takes no parameters.
 * @returns The dependency spec (a semver range, or a path/URL when overridden).
 * @throws Never - reads an environment variable.
 * @typeParam None - this function has no generic type parameters.
 */
export function cliSpec (): string {
  return process.env.MNCI_CLI_SPEC ?? CLI_VERSION
}

/**
 * The `eslint` version generated workspaces depend on.
 *
 * @remarks
 * `@mnci/eslint-config` peers on `eslint`, so it never installs one itself.
 *
 * ESLint **10**. What held the stack at 9 was never ESLint — it was
 * `eslint-plugin-react`, which has no 10 release at all and has since been
 * replaced by `@eslint-react/eslint-plugin`. See
 * {@link ESLINT_PEER_OVERRIDES} for the one holdout that remains.
 */
export const ESLINT_VERSION = '^10.8.0'

/**
 * The `.devcontainer/devcontainer.json` written into generated workspaces.
 *
 * @remarks
 * mnci's toolchain matrix is Node + Python + Go + Flutter, and until this existed
 * only **CI** had all four: the pipeline installs the Flutter SDK itself and
 * assumes CPython and Go are on the agent, while locally a contributor was on
 * their own. A devcontainer is what makes the local environment the same one CI
 * verifies, which is the whole "just works" promise applied to development rather
 * than to the build.
 *
 * Four decisions worth keeping:
 *
 * - **The Node major comes from {@link NODE_VERSION}**, the same constant the
 *   workflow's `setup-node` step reads. Hardcoding it twice is exactly the drift
 *   this file is supposed to remove.
 * - **`postCreateCommand` reuses the pipeline's own guards** rather than
 *   reimplementing them — {@link PYTHON_INSTALL_GUARD} and friends via the
 *   `python:install` root script, plus the same `golangci-lint` and Flutter SDK
 *   one-liners the pipelines run. Each is already idempotent and already
 *   no-ops when the workspace has no project of that kind (no `go.mod`, no
 *   `pubspec.yaml`), so a JS-only workspace pays almost nothing and a polyglot
 *   one gets exactly what CI gets. Reimplementing them would create a third
 *   copy to keep in sync.
 * - **Go, Python and .NET arrive as devcontainer *features*, not as a custom
 *   image.** A Dockerfile would be a second thing to maintain against
 *   upstream, and features are the mechanism the ecosystem maintains for
 *   precisely this. Unlike CI's install steps, a feature runs once at
 *   container build time rather than on every job, so there is no reason to
 *   gate it on the workspace actually having a project of that kind — Python
 *   and Go have never been gated either.
 * - **`ghcr.io/devcontainers/features/dotnet:2`'s `version` option takes
 *   `X.Y`/`X.Y.Z`, not {@link DOTNET_SDK_VERSION}'s `X.Y.x` verbatim** — that
 *   suffix is specifically what `actions/setup-dotnet` and `UseDotNet@2`
 *   expect (see its remarks), and the feature's own schema (checked directly
 *   against `devcontainer-feature.json`, proposals `latest`/`lts`/`10.0`/…)
 *   documents no `.x` form at all. The `.x` is stripped rather than a second
 *   constant maintained in parallel, so there is still exactly one source of
 *   truth to bump.
 * - **Flutter is NOT a feature**, because no maintained one exists — the same
 *   reason `@mnci/nx-flutter` had to be written. `mnci ci setup` clones a pinned
 *   tag into the home directory, which is what CI does, so the version matches
 *   by construction.
 *
 * @param workspaceName - The workspace name, used as the container's label.
 * @returns The JSON string for `.devcontainer/devcontainer.json`.
 * @throws Never - performs pure string formatting with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function devcontainerJson (workspaceName: string): string {
  return `${toJson({
    name:     workspaceName,
    image:    `mcr.microsoft.com/devcontainers/typescript-node:${NODE_VERSION}-bookworm`,
    features: {
      'ghcr.io/devcontainers/features/python:1': { version: '3.12' },
      'ghcr.io/devcontainers/features/go:1':     { version: 'latest' },
      'ghcr.io/devcontainers/features/dotnet:2': { version: DOTNET_SDK_VERSION.replace(/\.x$/, '') },
    },
    // `npm ci` first: every guard after it runs through the workspace's own
    // scripts and Nx, which do not exist until the install completes.
    postCreateCommand: [
      // Same pin the workflow applies, for the same reason — a container whose
      // npm major differs from CI's resolves dependencies differently, which is
      // precisely the drift this file exists to remove.
      `npm install -g npm@${NPM_VERSION}`,
      'npm ci',
      // The same command the pipeline runs: the Python, Go and Flutter toolchains, each
      // skipped when the workspace has no project in that language.
      'npx mnci ci setup',
    ].join(' && '),
    // The same recommendations the `.code-workspace` file carries, so opening
    // the folder in a container suggests the identical toolset.
    customizations: {
      vscode: { extensions: VSCODE_RECOMMENDED_EXTENSIONS },
    },
  })}\n`
}

/**
 * The `lint` target mnci puts on a generated workspace's ROOT project.
 *
 * @remarks
 * Without it, root-level files are linted by **nothing**. `npm run lint` is
 * `nx run-many -t lint`, and every other `lint` target belongs to a project and
 * runs `eslint .` with that project as its cwd — so `.github/workflows/*.yml`,
 * `azure-pipelines.yml`, the root JSON and Markdown, `eslint.config.mjs` and
 * `commitlint.config.mjs` were covered by no target at all.
 *
 * **The ignore patterns are CLI flags on purpose, not config `ignores`.** In flat
 * config, `ignores` are relative to the config file, and every project's `lint`
 * resolves this same root `eslint.config.mjs` — so ignoring `packages/**` there
 * would switch linting off *inside* the packages too. A CLI flag applies to this
 * invocation alone. Each project already lints its own tree, so this target adds
 * coverage rather than duplicating it.
 *
 * `includedScripts: []` goes alongside it, and is load-bearing: the root manifest's
 * scripts are the `nx run-many` aggregators, so letting Nx infer targets from them
 * would make `lint` invoke `nx run-many -t lint` — itself.
 */
export const ROOT_LINT_TARGET = {
  executor: 'nx:run-commands',
  cache:    true,
  options:  {
    command: [
      // `--cache` is the one ESLint speed option that actually pays here:
      // measured best-of-3 on this repo, an unchanged re-run drops from 9,546ms
      // to 2,835ms (3.4x). `--concurrency=auto` was measured too and REJECTED —
      // it came out 8% SLOWER, because per-worker TypeScript type-service
      // startup costs more than the parallelism saves. The cache file is
      // per-machine and gitignored.
      'eslint . --cache',
      '--ignore-pattern "apps/**"',
      '--ignore-pattern "libs/**"',
      '--ignore-pattern "packages/**"',
      '--ignore-pattern "python-packages/**"',
      '--ignore-pattern package-lock.json',
    ].join(' '),
    cwd: '.',
  },
} as const

/**
 * npm `overrides` for `@nx/*` peer ranges that are narrower than what they support.
 *
 * @remarks
 * `@nx/react@23.1.2` **added** `express: '^4.21.2'` as an optional peer in a
 * PATCH release — 23.1.0 and 23.1.1 declare no express peer at all. mnci's own
 * `node-app --framework express` installs express 5, so the two are
 * irreconcilable and `npm install` fails outright:
 *
 * ```
 * npm error Could not resolve dependency:
 * npm error peerOptional express@"^4.21.2" from @nx/react@23.2.1
 * npm error Conflicting peer dependency: express@4.22.3
 * ```
 *
 * `optional: true` is the trap: it means "you needn't install it", NOT "any
 * version is fine if you do". Once express is present the range is enforced.
 *
 * **The range is `@nx/node`'s own, not a number invented here.**
 * `@nx/node@23.2.1` declares `peerOptional express@'>=4.0.0 <6.0.0'`, and
 * `@nx/node` is the package that actually scaffolds the express app. So the
 * override says: resolve `@nx/react`'s express peer to the range the Nx
 * package that owns express already supports. Both majors satisfy it.
 *
 * **Unconditional, and that is the fix.** This used to be a function returning
 * `{ '@nx/react': { express: '$express' } }` only when the root manifest already
 * declared express, because `$express` is a dangling reference otherwise. Every
 * value was measured against a real workspace:
 *
 * | override value       | express 5 | express 4 | react-only |
 * | -------------------- | --------- | --------- | ---------- |
 * | `'$express'`         | works     | works     | **FAILS** — `Unable to resolve reference $express` |
 * | `'*'`                | FAILS     | works     | works      |
 * | `'^5.1.0'`           | works     | FAILS     | works      |
 * | `'>=4.0.0 <6.0.0'`   | works     | works     | works      |
 *
 * The last row is why this can be static, and being static is the whole point.
 * The conditional form could only be written **after** a generator had put
 * express in the manifest — but `nx g @nx/node:application --framework=express`
 * adds express and runs `npm install` in the SAME invocation, so the conflict
 * fired inside that generator, before any mnci post-generation step could write
 * the override. The old comment said "the very next add would otherwise be the
 * one that fails"; measured, it is THAT add that fails. A static entry written
 * at `mnci new` is already in place before any generator installs anything, and
 * it covers the reverse order too — a react-app added to a workspace that
 * already has express, where `nx add @nx/react` is the install that would die.
 *
 * Nothing in a generated workspace uses `@nx/react`'s express peer: react apps
 * build with Vite, and the peer exists for Nx's own module-federation/SSR
 * dev-server path, which mnci does not scaffold.
 */
export const NX_PEER_OVERRIDES = {
  '@nx/react': { express: '>=4.0.0 <6.0.0' },
} as const

/**
 * npm `overrides` a generated workspace needs for its ESLint toolchain to install.
 *
 * @remarks
 * `eslint-plugin-jsx-a11y@6.10.2` — the latest release — peers on
 * `eslint: ^3 … ^9`, so `npm install` fails outright with `ERESOLVE` on ESLint
 * 10. That cap is **stale rather than real**, and this was measured, not
 * assumed: with this override in place on `eslint@10.8.0`, the plugin installs
 * and its rules work — a missing `alt` reports `jsx-a11y/alt-text`, and
 * `alt="a picture"` reports `img-redundant-alt`.
 *
 * `overrides` has to live in the **root** manifest; npm ignores it anywhere
 * else, which is why a config package cannot carry its own fix and mnci writes
 * this instead. `$eslint` resolves to the workspace's own `eslint` spec, so the
 * override never pins a version of its own.
 *
 * The trade, stated rather than glossed: mnci deleted `legacy-peer-deps` from
 * the generated `.npmrc` precisely for weakening dependency resolution. This is
 * far narrower — one named package, one peer, with evidence that the real
 * constraint is satisfied — but it is the same kind of decision, so it should
 * be removed the moment `jsx-a11y` ships a release declaring ESLint 10.
 *
 * **`nx` → `brace-expansion` is a security fix, not a resolution fix, and it is
 * here because a generated workspace shipped six HIGH advisories without it.**
 * Measured by the audit step running inside a freshly generated workspace for the
 * first time: `brace-expansion` carries a high advisory, and `nx`, `@nx/js`,
 * `@nx/eslint`, `@nx/eslint-plugin` and `@nx/workspace` all inherit it. npm
 * reports the fix as **semver-major**, meaning `npm audit fix` would try to bump
 * `nx` itself — unacceptable in a scaffold — while a targeted override on the one
 * vulnerable transitive is both sufficient and safe.
 *
 * This repo has carried exactly this override for its own tree the whole time,
 * which is why its audit reads 0 while generated workspaces read 6. Same
 * dogfooding drift as the missing audit step: fixed here, never shipped. That is
 * the argument for the audit step being blocking — it found this the first time
 * it ever ran somewhere that mattered.
 *
 * **`nx` → `smol-toml` is the same drift, recurring.** `smol-toml <=1.7.0`
 * (GHSA-7w5x-hrqm-74c2, a parser DoS on malformed TOML) is a second instance of
 * "nx's own transitive dependency", fixed on this repo's own tree by nesting
 * `smol-toml` under the SAME `nx` entry already here for `brace-expansion` — and,
 * exactly like that fix, never carried over to what `mnci new` ships. A generated
 * workspace's own audit step caught it the moment C#/.NET support shipped an e2e
 * failure into the `flutter` section too: the SDK-resolution crash the broken
 * `nuget.config` XML caused (fixed separately, see `nugetConfigContent`) corrupted
 * the whole run's project graph, but the npm audit block on a *fresh* `demo`
 * workspace — generated **before** any C# kind ever touches `nuget.config` — was
 * failing independently, for this reason alone. Unlike `brace-expansion`, ONE
 * entry nested under `nx` is enough: `smol-toml` is a dependency of `nx` itself,
 * not independently required by each `@nx/*` package the audit names, so there is
 * no sibling edge for a per-parent override to reach — verified by running the
 * real `NPM_AUDIT_STEP` against a workspace carrying only this one entry.
 *
 * **`nx` → `axios` is the third instance, on the same day mnci fixed it for
 * itself.** `nx@23.2.x` depends on `axios ^1.18.1`, and every `axios` below
 * `1.20.0` carries twelve high advisories (prototype-pollution gadgets, ReDoS,
 * proxy and redirect bypasses; the widest, GHSA-9fr6-4gfg-395g and
 * GHSA-j8rh-479h-cp32, cover `>=1.0.0 <1.20.0`). This repo's own lockfile moved
 * to `1.20.0` in a8a27bb; a workspace generated an hour later still resolved
 * `1.18.1` and failed its first CI run, with `nx` and four `@nx/*` packages
 * flagged only for inheriting it. `axios` is reached through `nx` alone (in a
 * fresh workspace, `npm ls axios` shows one path), so it nests under the `nx`
 * entry exactly as `smol-toml` does. Found bootstrapping Lore Master
 * (russoedu/MarkDoc). Check `npm ls axios` before assuming a second path ever
 * appears, and drop the entry once the `nx` mnci installs requires `^1.20.0`.
 */
export const ESLINT_PEER_OVERRIDES = {
  'eslint-plugin-jsx-a11y': { eslint: '$eslint' },
  // Scoped to EACH named parent, not top-level and not `nx` alone.
  //
  // `nx` alone was the first attempt and it did not work: the e2e's audit step
  // still reported all six advisories in a freshly generated workspace, because
  // `@nx/js`, `@nx/eslint`, `@nx/eslint-plugin` and `@nx/workspace` are their own
  // dependents there, and an override scoped to `nx` never reaches a sibling's
  // dependencies. Those four are exactly the packages npm audit named.
  //
  // Top-level would be worse than wrong. A tree with `minimatch@3` legitimately
  // carries `brace-expansion@1.1.18` (and `@2.1.4` elsewhere) — this repo has
  // both — and forcing those to v5 breaks them. So the blast radius is one
  // dependency edge per named parent, and a test asserts there is no top-level
  // entry.
  'nx':                     { 'brace-expansion': '^5.0.9', 'smol-toml': '^1.7.1', 'axios': '^1.20.0' },
  '@nx/js':                 { 'brace-expansion': '^5.0.9' },
  '@nx/eslint':             { 'brace-expansion': '^5.0.9' },
  '@nx/eslint-plugin':      { 'brace-expansion': '^5.0.9' },
  '@nx/workspace':          { 'brace-expansion': '^5.0.9' },
  // `postcss` → `nanoid` reaches a generated workspace through `@nx/rollup`,
  // which every publishable `npm-lib` gets. GHSA-2v37-7h3g-55p8 is high, fixed in
  // 3.3.18, and the fix is a patch — so unlike the entry above this one is not
  // even a trade, just a version nobody had bumped yet.
  'postcss':                { nanoid: '^3.3.18' },
} as const

/**
 * Security overrides a generated workspace needs to pass its OWN npm audit gate.
 *
 * @remarks
 * Measured, not anticipated: a workspace straight out of `mnci new` plus one
 * `mnci add npm-lib` reported **8 high-severity advisories with zero lines of
 * user code**, and every one of them is actionable, so `NPM_AUDIT_STEP` exits 1
 * and CI is red on the first push. A scaffold that cannot pass the gate it
 * ships is the worst version of that gate — it teaches people to switch it off.
 *
 * All 8 are one advisory. `brace-expansion` GHSA-rgw5-rvv9-x895 (DoS via
 * unbounded intermediate arrays) covers `4.0.0 - 5.0.8`; `nx` and six `@nx/*`
 * packages are flagged only for depending on it. npm's own suggested remedy is
 * `nx@22.6.5` marked `isSemVerMajor` — a **downgrade of the build tool** by a
 * major, which nobody would take, and which is exactly why the audit step
 * reports `fixAvailable` rather than running `npm audit fix`.
 *
 * Two details make this override safe rather than a blunt pin:
 *
 * - It is keyed by the **vulnerable range**, not the bare package name. A plain
 *   `"brace-expansion": "^5.0.9"` would drag the `1.1.18` and `2.1.4` copies
 *   also present in the tree up to 5.x across a major API change, to fix an
 *   advisory neither of them has. Keyed this way, `npm install` removed exactly
 *   one package and left both others alone (verified).
 * - The fixed version was already resolved elsewhere in the same tree, so this
 *   deduplicates onto something npm had installed anyway rather than
 *   introducing a version nothing else uses.
 *
 * **Remove it when it stops being needed, and check rather than assume.** The
 * precedent is this repo's own `@verdaccio/config`/`js-yaml` pin, which read as
 * fixed while the advisory range had quietly been extended to include the
 * pinned version. The condition here is narrow: once the `nx` release this
 * scaffold installs no longer resolves a `brace-expansion` inside the
 * vulnerable range, this entry is dead weight. `npm audit` on a freshly
 * generated workspace is the check, and it is the only one that means anything.
 */
export const SECURITY_OVERRIDES = {
  'brace-expansion@4.0.0 - 5.0.8': '^5.0.9',
} as const

/**
 * The ESLint toolchain a generated workspace needs as real devDependencies.
 *
 * @remarks
 * Declaring these is load-bearing, and the reason is easy to miss: `eslint`
 * ends up in `node_modules` anyway (hoisted via `@mnci/eslint-config`), but
 * Nx's generators resolve it from the workspace **manifest**, not from disk.
 * Without the declaration, `mnci add npm-lib` fails outright with "Unable to
 * find `eslint`. Ensure a valid `eslint` version is installed" — verified
 * against a real generated workspace.
 *
 * `create-nx-workspace --preset=ts` does not install any of these; they used
 * to arrive incidentally, whenever the first `nx add @nx/react`-style plugin
 * install happened to pull them in. Now that mnci owns the root ESLint config
 * it owns the toolchain that config needs, rather than relying on that
 * accident.
 *
 * `@nx/eslint` (the `lint` target's executor and the inference plugin) and
 * `@nx/eslint-plugin` (the `@nx/dependency-checks` rule) are pinned to the
 * workspace's own Nx version — a mismatched pair breaks target inference.
 *
 * **The formatter is deliberately not here.** Every entry above is shared by
 * both linter modes — the hybrid keeps ESLint for the file types oxlint cannot
 * parse — whereas the formatter is exactly what the choice swaps. It is picked
 * in one place, at the call site, next to {@link oxlintToolchainDependencies}
 * and {@link LINTER_ONLY_DEPENDENCIES}.
 *
 * @param nxVersion - The `nx` version already in the workspace manifest.
 * @returns The devDependency entries to merge in.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function eslintToolchainDependencies (nxVersion: string): Record<string, string> {
  return {
    'eslint':              ESLINT_VERSION,
    '@nx/eslint':          nxVersion,
    '@nx/eslint-plugin':   nxVersion,
    '@mnci/eslint-config': eslintConfigSpec(),
  }
}

/**
 * Everything the overlay adds to a generated workspace's devDependencies that is mnci's own.
 *
 * @remarks
 * The ESLint toolchain, and the CLI the pipeline calls (see {@link CLI_VERSION}).
 *
 * @param nxVersion - The `nx` version already in the workspace manifest.
 * @returns The devDependency entries to merge in.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function mnciToolchainDependencies (nxVersion: string): Record<string, string> {
  return { ...eslintToolchainDependencies(nxVersion), '@mnci/cli': cliSpec() }
}

/**
 * Config files a previous mnci version wrote for a second tool, now deleted.
 *
 * @remarks
 * mnci has shipped three formatter arrangements: Prettier (`.prettierrc.json`,
 * later `.prettierrc.mjs`), an oxlint/oxfmt mode (`oxlint.config.ts`,
 * `.oxfmtrc.json`), and now none at all — ESLint formats. `applyOverlay`
 * removes every one of these on each run, and that is not tidiness.
 *
 * A leftover config is INERT from the command line, because nothing invokes
 * those binaries any more, and that is exactly what makes it dangerous: a
 * globally installed `esbenp.prettier-vscode` or `oxc.oxc-vscode` still
 * resolves it and still reformats on save. The editor then quietly undoes
 * Standard — no semicolons become semicolons, `function f (a)` loses its space
 * — while `npm run lint` reports nothing, because the file was reformatted
 * after the last check. The `.prettierrc` precedence bug in its third costume.
 */
export const RETIRED_FORMATTER_FILES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.mjs',
  '.prettierignore',
  'oxlint.config.ts',
  '.oxfmtrc.json',
] as const

/**
 * Drops the devDependencies of every formatter and linter mnci has retired.
 *
 * @remarks
 * The declaration is the point, not the install. `@mnci/eslint-config` no
 * longer depends on Prettier, so it leaves `node_modules` on its own — but a
 * workspace generated before the swap still DECLARES it, and the VS Code
 * extension resolves a formatter from the **project's** dependencies. Leaving
 * the declaration is what lets a globally installed extension find a real
 * `prettier` and reformat against an opinion nothing checks.
 *
 * Runs on `mnci upgrade` as well as `mnci new`, because a pre-swap workspace is
 * exactly the case that needs it — a fresh one has none of these to begin with.
 *
 * @param devDeps - The merged devDependencies for the root manifest.
 * @returns The same map without any retired tool.
 * @throws Never - pure object construction.
 */
export function withoutRetiredFormatterDependencies (
  devDeps: Record<string, string>,
): Record<string, string> {
  const retired = new Set([
    'prettier',
    'eslint-config-prettier',
    'oxlint',
    'oxfmt',
    '@mnci/oxlint-config',
  ])

  return Object.fromEntries(Object.entries(devDeps).filter(([name]) => !retired.has(name)))
}

/**
 * The block-by-block inventory written into the generated `eslint.config.mjs`.
 *
 * @remarks
 * Moving every rule into `@mnci/eslint-config` bought a generated workspace one
 * root config and cost it discoverability: a three-line file gives no hint that
 * twenty tools are behind it, and someone looking at a rule they disagree with
 * has nothing to grep. This names each block, what supplies it, and what it
 * covers — keyed by the `name` every block carries, which is what
 * `eslint --inspect-config` reports and what an override targets.
 *
 * **It is not free text.** A test in `overlay.test.ts` resolves the real config
 * and fails if a name here is missing from it, or if a block in it is missing
 * here. A stale inventory is worse than none, since it sends the reader to a
 * block that no longer exists — and nothing about generating a workspace would
 * notice.
 *
 * A separate constant from {@link ESLINT_MNCI_CONFIG} so that test can pull the
 * `mnci/…` names out of it without also matching the override example further
 * down, which names a `local/…` block that deliberately does not exist.
 *
 * Some entries end in `*`, and that is deliberate rather than lazy:
 * `mnci/yaml/recommended` and `mnci/toml/base` are multi-block upstream presets,
 * and `mnci/typescript`/`mnci/type-aware` each carry a `/declarations` sibling.
 * How many blocks those split into is not a user-facing fact, so enumerating
 * them here would make the table fail on an upstream release that changes
 * nothing anyone cares about.
 */
export const ESLINT_BLOCK_INVENTORY = `// WHAT IS IN HERE. Each line is one config block, by the \`name\` it carries.
//
//   mnci/ignores                  paths never linted (dist, coverage, .venv, …)
//   mnci/base                     JS/TS correctness — @eslint/js, eslint-plugin-unicorn,
//                                 -promise, -n, -unused-imports
//   typescript-eslint/*           typescript-eslint's own recommended blocks
//   mnci/typescript*              TS rules on top of them, no type information needed
//   mnci/type-aware*              the rules that DO read types (no-floating-promises and
//                                 friends), scoped to {apps,libs,packages}/*/src
//   mnci/import-graph             import cycles — eslint-plugin-import-x
//   mnci/react                    JSX/TSX — @eslint-react/eslint-plugin,
//                                 eslint-plugin-react-hooks, -react-refresh, -jsx-a11y
//   mnci/regexp*                  regex correctness — eslint-plugin-regexp
//   mnci/json  mnci/jsonc  mnci/json5
//                                 eslint-plugin-jsonc — comments are allowed in .jsonc
//                                 and tsconfig.json, forbidden in plain .json
//   mnci/yaml*                    eslint-plugin-yml — your CI pipeline files
//   mnci/toml/base*               eslint-plugin-toml, PARSER ONLY: a malformed
//                                 pyproject.toml is a syntax error, nothing is styled
//   mnci/markdown                 @eslint/markdown
//   mnci/css                      @eslint/css
//   mnci/html                     @html-eslint/eslint-plugin
//   mnci/tests                    *.spec/*.test relaxations — eslint-plugin-jest
//                                 (Vitest's globals too; the two stacks share them)
//   mnci/tests/mock-aware         specs in a project: eslint-plugin-jest's unbound-method,
//                                 which knows expect(mock.method) has no this to lose
//   mnci/nx-dependency-checks     @nx/eslint-plugin, on publishable packages' manifests
//   mnci/standard                 JavaScript Standard Style as ESLint rules — the
//                                 whole formatting opinion, a faithful port of
//                                 neostandard
//   mnci/house-style              the deliberate departures from Standard:
//                                 trailing commas, aligned object values,
//                                 consistent-as-needed quote-props, a blank line
//                                 before return. Composed LAST, on purpose:
//                                 nothing may follow that disables it.
//
// To list them as ESLint actually resolves them:  npx eslint --inspect-config
`

/**
 * The mnci-owned half of the ESLint configuration.
 *
 * @remarks
 * Rewritten by every `mnci upgrade`, which is why it is not the file ESLint
 * loads: {@link ESLINT_USER_FILENAME} is, and it imports this one.
 */
export const ESLINT_MNCI_FILENAME = 'eslint.config.mnci.mjs'

/**
 * The workspace's own half, and ESLint's actual entry point.
 *
 * @remarks
 * Written once and then never touched again, so a block appended to it
 * survives every upgrade. The name is ESLint's own default rather than a
 * choice — a flat config is found at `eslint.config.mjs`, so the file the tool
 * looks for has to be the one the workspace owns.
 */
export const ESLINT_USER_FILENAME = 'eslint.config.mjs'

/**
 * The rules, in the file mnci owns.
 *
 * @remarks
 * This is the half that `mnci upgrade` rewrites, and it is deliberately NOT
 * the file ESLint loads. ESLint's entry point is `eslint.config.mjs`, which
 * imports this one and belongs to the workspace — see {@link ESLINT_USER_CONFIG}
 * for why the two are separate at all.
 *
 * Deliberately one import: every rule lives in `@mnci/eslint-config`, so the
 * twenty-odd plugins are that package's dependencies instead of twenty-odd
 * devDependencies in every generated workspace.
 *
 * `workspaceRoot` enables the `@nx/dependency-checks` block for `packages/*`
 * and `libs/*` — it has to scan for `private: true` manifests, which is why it
 * needs the path rather than deriving one. `import.meta.dirname` is correct
 * here because both ESLint files sit at the workspace root.
 *
 * It exports a FUNCTION rather than the resolved array, and that is the one
 * part of the split that is not obvious. `@mnci/eslint-config` takes options —
 * `verticalSlices` most notably — and a workspace that wants one has nowhere
 * to put it if this file hands back an array it may not edit. mnci's own
 * repository is the proof: it passes `verticalSlices` scoped to the CLI, and
 * the first draft of this split would have had nowhere for that to live.
 *
 * Everything else in the file is comment: {@link ESLINT_BLOCK_INVENTORY}, then
 * the rules about formatters. Both are there because the alternative to
 * documenting a three-line config is a user editing `node_modules`.
 */
export const ESLINT_MNCI_CONFIG = `// GENERATED BY mnci. Every \`mnci upgrade\` overwrites this file.
//
// Do not edit it: put your own blocks in eslint.config.mjs next to it, which
// imports this one and which mnci never touches once it exists.
import mnci from '@mnci/eslint-config'

${ESLINT_BLOCK_INVENTORY}//
// FORMATTING IS LINTING HERE. There is no Prettier, no oxfmt and no
// \`format:check\` — \`npm run lint\` reports indentation, quotes and spacing as
// ordinary errors, and \`npm run format\` is \`eslint . --fix\`. So do not add a
// formatter: whichever one you pick will disagree with the \`mnci/standard\`
// block above, and because a formatter runs on save it wins silently, leaving
// \`lint\` to fail on files you never edited by hand.
//
// That also applies to the editor. Installing a Prettier or oxfmt extension is
// enough on its own — neither needs a config file, and with none present they
// format against their own defaults (semicolons, double quotes), which is the
// inverse of Standard.
//
// Exported as a FUNCTION, not as the resolved array. @mnci/eslint-config takes
// options — \`verticalSlices\` is the one a workspace is most likely to want —
// and an already-resolved array has nowhere to receive them. Calling it from
// eslint.config.mjs is what keeps every option reachable from the file you own.
//
// \`workspaceRoot\` is resolved HERE because both files sit at the root, and it
// is what enables the @nx/dependency-checks block.
//
// A named function declaration, exported inline. Both shapes matter and both
// are enforced by this very config: \`unicorn/no-anonymous-default-export\`
// rejects an anonymous arrow, and \`unicorn/default-export-style\` rejects
// declaring one above the export and referring to it. Either mistake fails a
// generated workspace's own lint on its first run.
export default function mnciConfig (options = {}) {
  return mnci({ workspaceRoot: import.meta.dirname, ...options })
}
`

/**
 * The workspace's own ESLint config: the file ESLint loads, written ONCE.
 *
 * @remarks
 * The reason this file exists at all is that the previous layout lost work.
 * `eslint.config.mjs` was mnci-owned and rewritten wholesale on every
 * `mnci upgrade`, so any block a workspace had appended to it — the documented
 * way to override a rule, in a comment mnci itself wrote three lines above —
 * was deleted without a word. Worse, `upgrade` then tells the user to run
 * `npm run format`, so the first thing that happens after the rules change is
 * that every file in the repository is rewritten against them.
 *
 * So the file is split. `eslint.config.mnci.mjs` carries the rules and stays
 * mnci's; this one carries the workspace's and is written only when it does
 * not already exist. {@link isUnmodifiedMnciEslintConfig} is what lets an
 * existing workspace cross over safely: an `eslint.config.mjs` still on the old
 * single-file layout is replaced only when it provably holds nothing of the
 * user's, and is otherwise left exactly as it is for `mnci doctor` to report.
 *
 * The spread rather than a re-export is deliberate: `...mnci()` puts the blocks
 * in an array the reader can append to, and appending is the whole point.
 */
export const ESLINT_USER_CONFIG = `// This file is YOURS. mnci writes it once and never touches it again, so
// anything you add here survives \`mnci upgrade\`.
//
// The rules live in ./eslint.config.mnci.mjs, which mnci DOES rewrite on every
// upgrade — so put your changes here, not there.
import mnci from './${ESLINT_MNCI_FILENAME}'

// TO CONFIGURE the shared rules, pass options to mnci() below — e.g.
// \`...mnci({ verticalSlices: ['packages/*/src/**/*.ts'] })\`.
//
// TO OVERRIDE a rule, append a block AFTER the spread — later blocks win, so
// one of your own beats anything above it. Give it a name, so
// \`npx eslint --inspect-config\` shows where the change came from:
//
//   {
//     name: 'local/legacy-app-allows-any',
//     files: ['apps/legacy/**/*.ts'],
//     rules: { '@typescript-eslint/no-explicit-any': 'off' }
//   }
//
// Do NOT edit @mnci/eslint-config inside node_modules, and do not fork it: it
// is a dependency, so \`npm update\` brings rule fixes in the way it brings any
// other. An override here survives that; an edit to the package does not.
export default [
  ...mnci(),
]
`

/**
 * Whether an existing `eslint.config.mjs` is unmodified mnci output.
 *
 * @remarks
 * The question this answers is narrow and the answer has to be certain:
 * *may this file be replaced without losing anything a human wrote?* It is
 * asked once, when a workspace on the old single-file layout is upgraded.
 *
 * So it does not guess. Every comment and blank line is dropped, and what is
 * left has to be exactly the two statements mnci has always generated — the
 * import of `@mnci/eslint-config` and the default export of one call to it.
 * Anything else at all, including a block appended in the documented way,
 * makes this false and the file is left alone.
 *
 * Comments are recognised as lines whose first non-space characters are `//`,
 * which is the only comment form the generated file has ever used. A file
 * using another form simply fails to match, which is the safe direction: the
 * cost of a false negative is a `mnci doctor` finding, and the cost of a false
 * positive is deleted work.
 *
 * @param content - The file's current contents.
 * @returns Whether replacing it can lose nothing.
 * @throws Never - any content that does not match reads as modified.
 * @typeParam None - this function has no generic type parameters.
 */
export function isUnmodifiedMnciEslintConfig (content: string): boolean {
  const code = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('//'))

  return (
    code.length === 2 &&
    code[0] === "import mnci from '@mnci/eslint-config'" &&
    code[1] === 'export default mnci({ workspaceRoot: import.meta.dirname })'
  )
}

/**
 * Writes a pipeline file, keeping what the team put in its slots and switched off.
 *
 * @remarks
 * The file is regenerated, but the contents of its `# mnci:slot` blocks and the phase blocks the
 * team commented out or deleted are carried over (see `mergePipeline`). A file from before the
 * markers existed is replaced whole, and the user is told through `onProgress`.
 *
 * @param path - Absolute path of the pipeline file.
 * @param onProgress - Receives a line for each thing the user should know.
 * @param generated - The freshly generated text.
 * @returns Nothing.
 * @throws Error when the file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
function writePipeline (path: string, onProgress: (line: string) => void, generated: string): void {
  const { text, notes } = mergePipeline(existsSync(path) ? readFileSync(path, 'utf8') : undefined, generated)
  for (const note of notes) {
    onProgress(`  ${note}`)
  }
  writeFileEnsured(path, text)
}

/**
 * Writes `eslint.config.mjs` only when doing so cannot lose anything.
 *
 * @remarks
 * Three cases, and they are all the cases there are:
 *
 * - **Absent** — a new workspace, or one that has never had the split. Write
 *   it.
 * - **Present and unmodified mnci output** — a workspace on the old
 *   single-file layout that never overrode anything. Replacing it moves it
 *   onto the split and loses only comments mnci wrote itself, so write it.
 * - **Present and modified** — either already on the split, or on the old
 *   layout with the user's own blocks in it. Leave it. `mnci doctor` reports
 *   the second of those, because a config that no longer reaches
 *   `eslint.config.mnci.mjs` silently lints against nothing but its own blocks.
 *
 * @param workspaceRoot - Absolute path of the workspace root.
 * @param onProgress - Receives one line per file, for the CLI's output.
 * @returns Nothing.
 */
function writeEslintEntryPoint (workspaceRoot: string, onProgress: (line: string) => void): void {
  const path = join(workspaceRoot, ESLINT_USER_FILENAME)
  if (existsSync(path) && !isUnmodifiedMnciEslintConfig(readFileSync(path, 'utf8'))) {
    onProgress(`${ESLINT_USER_FILENAME} — kept as it is, it is yours`)

    return
  }

  onProgress(`${ESLINT_USER_FILENAME} — the entry point, yours to edit from now on`)
  writeFileEnsured(path, ESLINT_USER_CONFIG)
}

/**
 * The editor extensions both the `.code-workspace` file and the devcontainer
 * recommend.
 *
 * @remarks
 * Shared so the two cannot drift: opening the workspace in a container should
 * suggest the same toolset as opening it directly.
 *
 * **`esbenp.prettier-vscode` is deliberately absent, and its absence is the
 * point.** mnci recommended it for as long as Prettier owned formatting, and
 * kept recommending it for a while after ESLint took over — which made mnci the
 * thing that installed its own hazard. The extension does not need a config
 * file to act: with none present it formats against Prettier's own defaults,
 * semicolons and double quotes, the exact inverse of Standard. It reformats on
 * save, so the damage lands *after* every gate has run and `lint` stays green
 * until the next time someone looks. {@link RETIRED_FORMATTER_FILES} exists to
 * clean up after precisely that, and recommending the extension alongside it
 * was the two halves of one decision disagreeing.
 */
export const VSCODE_RECOMMENDED_EXTENSIONS = [
  'dbaeumer.vscode-eslint',
  'nrwl.angular-console',
  'firsttris.vscode-jest-runner',
] as const

/**
 * Every language whose formatter mnci pins to the ESLint extension.
 *
 * @remarks
 * Not a convenience list — see {@link vscodeSettings} for why the general
 * `editor.defaultFormatter` cannot be relied on. Each entry is a language
 * `@mnci/eslint-config` actually has a parser and rules for, so that
 * format-on-save routes to a tool with an opinion about the file rather than to
 * whatever the user happens to have installed.
 *
 * `typescript` and `typescriptreact` are the two that matter most and were once
 * the two missing, which is the bug {@link vscodeSettings} documents.
 *
 * This list used to be justified as "everything **both** formatters handle",
 * measured against the real Prettier and oxfmt binaries. Both are retired, so
 * the membership test is now a single question — does the shared ESLint config
 * cover this language — and nothing has to be kept in agreement with a second
 * tool.
 */
export const FORMATTED_LANGUAGES = [
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'json',
  'jsonc',
  'yaml',
  'markdown',
  'css',
  'html',
  // TOML is here for PARSING, not formatting, and the distinction is measured
  // rather than assumed: `eslint --fix` leaves a badly-laid-out `.toml`
  // byte-identical (the TOML block is `flat/base`, parser only — `flat/standard`
  // reported six errors on the `pyproject.toml` mnci itself generates), but it
  // DOES report `Parsing error: ...` on a malformed one.
  //
  // So the entry buys two things. `eslint.validate` gains toml, so a broken
  // `pyproject.toml` is flagged in the editor rather than at the next CI run.
  // And pinning the formatter to ESLint means format-on-save does nothing to the
  // file instead of handing it to whichever TOML formatter the user happens to
  // have installed — the same reasoning as every other entry here: nothing
  // reformats against an opinion no gate checks.
  //
  // Impossible under the Prettier stack, which is why it is only here now:
  // `npx prettier` on a `.toml` exits with "No parser could be inferred".
  'toml',
] as const

/**
 * The editor settings that depend on the linter choice.
 *
 * @remarks
 * Two things change together, and they have to: which extension formats, and
 * which languages ESLint is asked to validate.
 *
 * `eslint.validate` lists every language in {@link FORMATTED_LANGUAGES},
 * because ESLint owns all of them now. There is no second formatter to hand any
 * of them to, and so no narrowed variant of this list to keep in step.
 *
 * @returns The `settings` block for the `.code-workspace` file.
 * @throws Never - performs pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeSettings (): Record<string, unknown> {
  // ESLint is the formatter now, so `editor.defaultFormatter` points at the
  // ESLint extension and `source.fixAll.eslint` is what actually reformats on
  // save. There is no second formatter to disagree with it.
  const formatter = 'dbaeumer.vscode-eslint'
  const eslintLanguages = [...FORMATTED_LANGUAGES]

  return {
    'eslint.validate':          eslintLanguages,
    'editor.codeActionsOnSave': {
      'source.fixAll.eslint': 'explicit',
    },
    'editor.defaultFormatter': formatter,
    'editor.formatOnSave':     true,
    // Every language spelled out, and the global default above is NOT enough on
    // its own — which is the bug this fixes rather than a belt-and-braces habit.
    //
    // VS Code resolves a language-specific setting ahead of a general one, and it
    // does that comparison BEFORE scope. So a `[typescript]` block in someone's
    // USER settings — left over from any other project — outranks this file's
    // workspace-level `editor.defaultFormatter`, and format-on-save quietly uses
    // that other formatter instead — and nothing reports it, because the gate
    // and the editor are looking at different tools. That is how it was found:
    // reported from a real workspace, not deduced from the docs.
    //
    // Reported from a real workspace where `.ts` files were not being formatted
    // while `.json`/`.jsonc`/`.yaml` were — exactly the three that had explicit
    // entries here and nothing else did.
    ...Object.fromEntries(
      FORMATTED_LANGUAGES.map(language => [
        `[${language}]`,
        { 'editor.defaultFormatter': formatter },
      ]),
    ),
  }
}

/**
 * Prefix marking a launch configuration as mnci-owned.
 *
 * @remarks
 * Every configuration mnci writes carries it, so a person can tell them from their own at a glance. It is NOT
 * what `vscodeWorkspace` merges on: that replaces mnci's workspace-level entries by their exact name and carries
 * every other configuration through, including the per-project `mnci: <project> start` entries
 * `registerProjectCommands` writes. A prefix match deleted those on every `mnci upgrade` (#230).
 */
export const LAUNCH_CONFIG_PREFIX = 'mnci: '

/**
 * The verify targets exposed in VS Code's **Run and Debug** panel.
 *
 * @remarks
 * Tasks alone were not enough. A `tasks` entry is only reachable through
 * *Terminal -\> Run Task*; the Run and Debug dropdown reads `launch`, so a workspace
 * with tasks and no launch section offers nothing there at all. These four are the
 * same targets the root `affected` script runs.
 *
 * **They drive npm scripts, not the Nx binary.** Pointing `program` at
 * `node_modules/nx/bin/nx.js` would be wrong: Nx ships its bin at
 * `dist/bin/nx.js`, and that path is version-dependent. `npm run \<script\>` is stable,
 * needs no path into `node_modules`, and tracks whatever the root script does — so a
 * change to `ROOT_SCRIPTS` reaches these for free.
 *
 * **`node-terminal`, not `node`, and that is the load-bearing choice.** It runs the
 * command in VS Code's JS Debug Terminal, which instruments **child** processes as
 * they spawn. `nx run-many` executes every target in a child process, so a plain
 * `node` launch would attach to the Nx parent alone and a breakpoint inside a spec
 * would never bind. It also needs no `console` setting: a plain `node` launch
 * defaults to `internalConsole`, which renders none of Nx's progress output, so a
 * build there looks like a hang.
 */
export const LAUNCH_CONFIGURATIONS = ['build', 'test', 'lint', 'typecheck'] as const

/**
 * Builds the `launch.configurations` array for a generated workspace.
 *
 * @remarks
 * One entry per {@link LAUNCH_CONFIGURATIONS} target, each named with
 * {@link LAUNCH_CONFIG_PREFIX} so an upgrade can tell its own entries from a
 * user's. Order matches the verify order the root `affected` script runs.
 *
 * @param workspaceName - The workspace name, used to scope `${workspaceFolder}`.
 * @returns One configuration per entry in {@link LAUNCH_CONFIGURATIONS}.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function launchConfigurations (workspaceName: string): Record<string, unknown>[] {
  return LAUNCH_CONFIGURATIONS.map((script, index) => ({
    type:         'node-terminal',
    request:      'launch',
    name:         `${LAUNCH_CONFIG_PREFIX}${script}`,
    command:      `npm run ${script}`,
    // Scoped by folder name rather than a bare ${workspaceFolder}: that variable is
    // ambiguous once a second folder is added to the workspace, and VS Code then
    // refuses to resolve it.
    cwd:          `\${workspaceFolder:${workspaceName}}`,
    // One shared group keeps the four together in the dropdown; a per-entry group
    // would make four groups of one. `order` holds them in verify order.
    presentation: { group: 'mnci', order: index + 1 },
  }))
}

/**
 * The launch configuration for one project's `start` script.
 *
 * @remarks
 * Written by `registerProjectCommands` for every kind that has a `start`, and merged by its exact name
 * (`mnci: <project> start`) so adding a second project, or an upgrade, replaces only this entry. It drives the
 * workspace's own `<project>:start` npm script, like the workspace-level entries, and uses `node-terminal` for the
 * same reason: `start` runs through `nx run`, which spawns the program as a child process.
 *
 * @param workspaceName - The VS Code folder name, used to scope `${workspaceFolder}`.
 * @param projectName - The Nx project name.
 * @returns One launch configuration.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function projectLaunchConfiguration (workspaceName: string, projectName: string): Record<string, unknown> {
  return {
    type:         'node-terminal',
    request:      'launch',
    name:         `${LAUNCH_CONFIG_PREFIX}${projectName} start`,
    command:      `npm run ${projectName}:start`,
    cwd:          `\${workspaceFolder:${workspaceName}}`,
    presentation: { group: 'mnci projects' },
  }
}

/**
 * VS Code workspace file template for generated monorepos.
 *
 * @remarks
 * Creates a single .code-workspace file that configures the entire monorepo:
 * folder structure, recommended extensions (ESLint, Nx, Jest), workspace
 * settings, and a `tasks` array. The array starts empty; `add/*.ts`'s
 * `registerProjectCommands` (`commands/add/shared.ts`) appends a
 * `build`/`qa`/`start` task per project as it is added, so this template
 * itself carries no project-specific content — it must stay generic across
 * every `mnci new`-generated workspace, not just this repo's own dogfooded
 * root.
 * It also carries a `launch` section, because a `tasks` entry is reachable only
 * through *Terminal -\> Run Task* while the **Run and Debug** panel reads `launch` —
 * a workspace with tasks alone offers nothing there. See
 * {@link LAUNCH_CONFIGURATIONS}. Unlike `tasks`, which is carried through wholesale,
 * the launch array is merged: mnci replaces only its own `mnci: *` entries.
 * Users open this file in VS Code (`File > Open Workspace from File`).
 *
 * **`existingTasks` is what keeps `mnci upgrade` non-destructive**, and the need
 * for it was masked by another bug. The overlay owns this file's folders,
 * settings and extensions, but the `tasks` array is per-project state written by
 * `mnci add`, not by the overlay — so regenerating the file wholesale destroys
 * every registered task. That never surfaced only because upgrade used to write
 * to `undefined.code-workspace` and leave the real file untouched; fixing the
 * filename exposed it immediately (verified: a workspace with three projects lost
 * all five of its tasks). Tasks are carried through verbatim rather than
 * regenerated, since the overlay has no idea which projects exist.
 *
 * @param workspaceName - The workspace name.
 * @param existingTasks - The `tasks` object read from a file already on disk, to
 * carry through unchanged. Omitted for a fresh `mnci new`, where there is none.
 * @returns The JSON string for a .code-workspace file.
 * @throws Never - performs pure string formatting with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeWorkspace (
  workspaceName: string,
  existingTasks?: { version?: string; tasks?: Record<string, unknown>[] },
  existingLaunch?: { version?: string; configurations?: Record<string, unknown>[] },
  existingSettings?: Record<string, unknown>,
): string {
  // Additive, like nx.json's sharedGlobals: mnci replaces only the configurations it owns, by EXACT name, and
  // carries every other one through. That keeps a hand-written debug config AND the per-project entries `mnci add`
  // wrote (`mnci: <project> start`), which the old prefix match deleted on every upgrade (#230). Tasks are carried
  // through wholesale instead, because `mnci add` — not the overlay — is what writes them.
  const ownedNames = new Set(launchConfigurations(workspaceName).map(configuration => configuration.name))
  const userConfigurations = (existingLaunch?.configurations ?? []).filter(
    (configuration) => !ownedNames.has(configuration.name),
  )
  // Settings are MERGED, with mnci winning on the keys it owns. Replacing them
  // wholesale destroyed every setting a workspace had added for itself — measured on
  // this repo's own file, where an upgrade would have deleted a 1,179-entry
  // `cSpell.words` dictionary that nothing else stores. mnci overwrites only the
  // keys it actually sets, so its opinion still lands on every upgrade while
  // anything it has no opinion about survives.
  const settings = { ...existingSettings, ...vscodeSettings() }

  // `toJson`, like every other JSON file mnci writes: it ends with a newline.
  // Bare JSON.stringify did not, while `mnci new`'s format pass adds one, so
  // every `mnci upgrade` showed the same one-character diff on this file.
  return toJson(
    {
      folders:    [{ path: '.', name: workspaceName }],
      settings,
      extensions: { recommendations: VSCODE_RECOMMENDED_EXTENSIONS },
      tasks:      {
        version: existingTasks?.version ?? '2.0.0',
        tasks:   existingTasks?.tasks ?? [],
      },
      launch: {
        version:        existingLaunch?.version ?? '0.2.0',
        configurations: [...launchConfigurations(workspaceName), ...userConfigurations],
      },
    },
  )
}

/**
 * The curated npm scripts stamped into a generated workspace's root manifest.
 *
 * @remarks
 * Each one is a single cross-platform Nx (or husky) invocation — the everyday
 * entry points, nothing more. `affected` compares against `main`
 * (`defaultBase` in `nx.json`); `release:preview` shows what `nx release`
 * would do on CI without touching anything.
 *
 * `typecheck` is its own script because nothing else type-checks. Under
 * `--preset=ts` the `@nx/js/typescript` plugin infers a `typecheck` target for
 * every project, but a bundler-built project's `build` does not type-check at
 * all — esbuild and swc strip types without reading them. So a workspace can
 * build, test and lint green while carrying real type errors, which is exactly
 * what happened in mnci's own repo: `mnci upgrade` shipped a bug that
 * TypeScript had already flagged, because CI never ran this.
 */
export const ROOT_SCRIPTS = {
  'build':           'nx run-many -t build',
  'lint':            'nx run-many -t lint',
  'test':            'nx run-many -t test',
  'typecheck':       'nx run-many -t typecheck',
  'affected':        'nx affected -t lint,typecheck,test,build',
  'graph':           'nx graph',
  'release:preview': 'nx release --dry-run',
  'prepare':         'husky',
} as const

/**
 * The curated scripts, with ESLint doing both the linting and the formatting.
 *
 * @remarks
 * ESLint is a per-project Nx target (`nx run-many -t lint`) covering code
 * quality, type-aware correctness *and* JavaScript Standard Style formatting.
 * `npm run format` is `eslint . --fix`; there is no `format:check`, because
 * `lint` already reports a formatting mistake as an ordinary error.
 *
 * Every stack also gets `python:install`, chaining the same two guards CI runs
 * ({@link PYTHON_INSTALL_GUARD} then {@link PYTHON_WORKSPACE_INSTALL_GUARD}) —
 * the fixed dev toolchain (ruff/pytest/build/twine) plus an editable install of
 * every workspace Python project, so a fresh clone's `pip install` step is one
 * command instead of "read the CI pipeline to find the right invocation". Both
 * guards already no-op cleanly on a workspace with no Python projects, so it is
 * safe to stamp unconditionally rather than gating on whether one exists yet.
 *
 * @returns The root scripts object to stamp into the manifest.
 * @throws Never - pure mapping.
 */
export function rootScripts (): Record<string, string> {
  return {
    ...ROOT_SCRIPTS,
    // ESLint is the formatter, so `format` is `--fix` and there is no separate
    // `format:check`: `lint` already reports formatting as ordinary errors.
    // Carrying a second script that ran the same tool twice would just make a
    // CI run slower for no extra coverage.
    'format':         'eslint . --fix --cache',
    'python:install': `${PYTHON_INSTALL_GUARD} && ${PYTHON_WORKSPACE_INSTALL_GUARD}`,
  }
}

/**
 * The Nx `generators` defaults patched into `nx.json` from the chosen stack.
 *
 * @remarks
 * Lets a user's own **direct** `nx g @nx/react:app ...` (outside `mnci add`)
 * pick up the workspace's chosen test runner automatically, and — via
 * `linter: 'none'` — keep the workspace's single root ESLint config intact
 * instead of scaffolding a competing per-project one.
 *
 * `mnci add` itself does **not** read this back — see {@link mnciConfig} for
 * the dedicated, single-source-of-truth block it reads instead. The two used
 * to be conflated (`add` inferred the stack from one of these three identical
 * blocks), an implicit "all three stay in lockstep" invariant nothing enforced.
 *
 * @param stack - The chosen stack.
 * @returns The `generators` object for `nx.json`.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
export function generatorDefaults (stack: StackConfig): Record<string, unknown> {
  const shared = {
    // `none`, not `eslint`, and the workspace is still fully linted. The root
    // config plus `@nx/eslint/plugin` ({@link ESLINT_PLUGIN_CONFIG}) give every
    // project its `lint` target; `eslint` here would only make the generator
    // scaffold a per-project config mnci deletes anyway — and drag in
    // `eslint-plugin-import@2.31.0`, which peer-caps at ESLint 9 and breaks the
    // install outright on this workspace's ESLint 10.
    linter:         'none',
    unitTestRunner: stack.testRunner,
  }

  return {
    '@nx/react:application': shared,
    '@nx/react:library':     shared,
    '@nx/js:library':        shared,
  }
}

/**
 * The `mnci` block patched into `nx.json` from the options a `new`/`upgrade`
 * call resolved.
 *
 * @remarks
 * Two independent readers trust this one block: `mnci add`'s
 * `readWorkspaceStack` (`add.ts`) reads only `.stack`, and `mnci upgrade`
 * (`readMnciConfig`, below) reads the whole thing back as the defaults for
 * everything an explicit flag does not override — the only reason `scope`/
 * `registry`/`agent`/`variableGroup`/`ci` are persisted at all, since nothing
 * else in a generated workspace records them. Deliberately separate from
 * {@link generatorDefaults}, which serves Nx's own generator-default
 * mechanism instead (a real, independent feature: it makes a user's own
 * direct `nx g` pick up the right defaults too).
 *
 * @param options - The resolved overlay options (a `new`/`upgrade` call).
 * @returns The `mnci` object for `nx.json`.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
export function mnciConfig (options: OverlayOptions): Record<string, unknown> {
  return {
    // Persisted so `mnci upgrade` can name the `<name>.code-workspace` file it
    // rewrites. Its absence is why upgrade used to write a file literally called
    // `undefined.code-workspace` and therefore never refreshed the real one —
    // see `resolveWorkspaceName` in `commands/upgrade.ts`, which still needs a
    // fallback chain for workspaces generated before this field existed.
    workspaceName: options.workspaceName,
    scope:         options.scope,
    registry:      options.registry,
    agent:         options.agent,
    variableGroup: options.variableGroup,
    ci:            options.ci,
    stack:         { testRunner: options.stack.testRunner },
    // Only when chosen: a workspace on the default keeps the block it always had,
    // so an upgrade does not add a field nobody asked for.
    ...(options.npmAuth !== undefined && { npmAuth: options.npmAuth }),
  }
}

/**
 * Reads back whatever a previous `new`/`upgrade` call persisted via
 * {@link mnciConfig}.
 *
 * @remarks
 * The read-side counterpart `mnci upgrade` (`commands/upgrade.ts`) uses to
 * resolve options: an explicit flag wins, otherwise the persisted value here
 * is the default, so a plain `mnci upgrade` with no flags re-applies the
 * exact same overlay the workspace already has, just regenerated from
 * today's `overlay.ts`. A workspace generated before this was persisted (or
 * hand-edited to remove it) simply has fewer fields here — `upgrade` reports
 * exactly which ones are missing rather than guessing.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Whatever subset of {@link OverlayOptions} is persisted in
 * `nx.json`'s `mnci` block (empty object when there is none).
 * @throws Propagates any Node.js `fs`/JSON error reading `nx.json`.
 * @typeParam None - this function has no generic type parameters.
 */
export function readMnciConfig (workspaceRoot: string): Partial<OverlayOptions> {
  const nxJson = readJson<Record<string, unknown>>(join(workspaceRoot, 'nx.json'))

  return (nxJson.mnci as Partial<OverlayOptions> | undefined) ?? {}
}

/**
 * The Python package registry's `twine upload` URL for a registry config.
 *
 * @remarks
 * Azure Artifacts feeds are **multi-protocol**: the same org/project/feed that
 * serves npm also serves Python, so the pypi upload URL is derived from the same
 * {@link RegistryConfig} — no separate Python registry prompt at `new`. Public
 * npm has no Python analogue wired in this cut (publishing to public PyPI needs
 * a PyPI token, a separate mechanism), so it returns `undefined` and the CI
 * Python-publish step is omitted.
 *
 * @param registry - The monorepo's resolved registry configuration.
 * @returns The pypi upload URL for Azure Artifacts, or `undefined` for npm.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function pythonPublishUrl (registry: RegistryConfig): string | undefined {
  if (registry.kind === 'azure-artifacts') {
    return `https://pkgs.dev.azure.com/${registry.organization}/${registry.project}/_packaging/${registry.artifactsFeed}/pypi/upload/`
  }

  return undefined
}

/**
 * The Azure Artifacts NuGet v3 feed URL for a registry config.
 *
 * @remarks
 * Same multi-protocol feed {@link pythonPublishUrl} already reads — one
 * org/project/feed serves npm, Python **and** NuGet — so this is the third
 * reader of the same {@link RegistryConfig}, not a separate prompt. Public
 * npm has no NuGet analogue wired in this cut, the same gap
 * {@link pythonPublishUrl}'s own remarks document for PyPI: publishing to
 * public nuget.org needs a nuget.org-issued API key, a credential mnci
 * collects nowhere, so this returns `undefined` and `csharp-lib` is
 * versioned + tagged but not auto-published — see {@link addCsharpLib}.
 *
 * @param registry - The monorepo's resolved registry configuration.
 * @returns The NuGet v3 service index URL for Azure Artifacts, or
 * `undefined` for npm.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function nugetFeedUrl (registry: RegistryConfig): string | undefined {
  if (registry.kind === 'azure-artifacts') {
    return `https://pkgs.dev.azure.com/${registry.organization}/${registry.project}/_packaging/${registry.artifactsFeed}/nuget/v3/index.json`
  }

  return undefined
}

/**
 * The fixed `nuget.config` source key mnci registers the Azure Artifacts
 * NuGet feed under.
 *
 * @remarks
 * Deliberately a constant, not `registry.artifactsFeed` — the real feed
 * name. `packageSourceCredentials` attaches to a source by its registered
 * KEY, not its URL, so the publish target in `add/csharp.ts`
 * (`dotnet nuget push --source ...`) needs to name the SAME key
 * {@link nugetConfigContent} registers. Fixing it here means that target
 * needs no {@link RegistryConfig} of its own at generation time — it just
 * references this constant — which is what keeps `addCsharpLib` from
 * needing to re-derive the workspace's registry choice per `add`, the way
 * Python's `nx-release-publish` target also carries no registry specifics
 * of its own (its `TWINE_*` env vars are injected only at CI release time).
 */
export const NUGET_AZURE_SOURCE = 'AzureArtifacts'

/**
 * Builds the `nuget.config` body for a registry configuration.
 *
 * @remarks
 * Mirrors {@link npmrcContent}'s split, but the underlying auth mechanics
 * genuinely differ — verified against NuGet's own docs
 * (`nuget.config` file reference, and Azure Artifacts' "Publish NuGet
 * packages with dotnet CLI" guide), not assumed from the `.npmrc` case:
 *
 * - **NuGet's env-var substitution is `%VAR%` on every platform, never
 *   `${VAR}` or `$VAR`.** Confirmed from Microsoft's own compatibility
 *   table: `$MY_VAR` resolves on none of `nuget.exe`/`dotnet.exe`, Windows or
 *   Mac. Getting this backwards is the exact class of trap the `.npmrc`
 *   Bearer-vs-Basic saga already cost this repo once — a config that
 *   *parses* but silently never substitutes anything.
 * - **`packageSourceCredentials` attaches to a REGISTERED source by key**,
 *   not to the URL passed to `--source` at push time — confirmed by Azure's
 *   own guide, which registers the feed under `packageSources` even though
 *   `dotnet nuget push --source <url>` alone would also resolve the URL.
 *   Skipping registration would leave the credentials with nothing to
 *   attach to. {@link NUGET_AZURE_SOURCE} is that key.
 * - **`packageSourceMapping` scopes the private feed to this workspace's own
 *   `<PascalScope>.*` packages**, the direct analogue of `.npmrc`'s
 *   scope-only routing and for the identical reason: an unscoped
 *   `<packageSources>` entry would have every `dotnet restore` — including a
 *   contributor's local one, with no PAT set — query the private feed for
 *   packages that were never going to be found there, on every build.
 * - **Public nuget.org needs no credentials at all** — restore is anonymous,
 *   and {@link nugetFeedUrl}'s remarks explain why publish is left
 *   unconfigured for that choice rather than half-wired.
 *
 * The one PAT is the same **raw** value `twine` already uses (see
 * {@link pythonPublishEnvFragment}), not the base64 form `.npmrc`'s
 * `_password` takes — NuGet's Basic auth is handled by the HTTP client
 * itself from a plain `Username`/`ClearTextPassword` pair, so no manual
 * base64 step belongs here.
 *
 * @param registry - The monorepo's resolved registry configuration.
 * @param scope - The npm scope (e.g. `@demo`); its PascalCase form is the
 * `packageSourceMapping` pattern, matching {@link addCsharpLib}'s own
 * `<PascalScope>.<PascalName>` NuGet identity.
 * @returns The full text of the generated `nuget.config`.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function nugetConfigContent (registry: RegistryConfig, scope: string): string {
  if (registry.kind === 'npm') {
    return `<?xml version="1.0" encoding="utf-8"?>
<!-- Publish authentication for NuGet is deliberately UNCONFIGURED for the
     public npm registry choice: publishing to public nuget.org needs a
     nuget.org-issued API key, a credential mnci collects nowhere (the same
     gap Python's PyPI publish has for this same registry choice). A
     csharp-lib is still versioned and tagged; run "dotnet nuget push"
     yourself with your own key, or regenerate choosing the azure-artifacts
     registry instead. -->
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>
`
  }

  const pascalScope = scope
    .replace(/^@/, '')
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  const feedUrl = nugetFeedUrl(registry) as string

  return `<?xml version="1.0" encoding="utf-8"?>
<!-- NuGet's own environment-variable syntax is '%VAR%' on every platform —
     never '\${VAR}'/'$VAR', which resolve on none of them. NUGET_PAT is the
     RAW PAT (not base64 — unlike .npmrc's _password, NuGet's HTTP client
     handles Basic auth itself from Username + ClearTextPassword), exported
     only by the CI release step (see nugetPublishEnvFragment in mnci); an
     ordinary build/test/lint step never needs it, since packageSourceMapping
     below scopes this feed to ${pascalScope}.* packages only. -->
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="${NUGET_AZURE_SOURCE}" value="${feedUrl}" />
  </packageSources>
  <packageSourceCredentials>
    <${NUGET_AZURE_SOURCE}>
      <add key="Username" value="AzureArtifacts" />
      <add key="ClearTextPassword" value="%NUGET_PAT%" />
    </${NUGET_AZURE_SOURCE}>
  </packageSourceCredentials>
  <packageSourceMapping>
    <clear />
    <packageSource key="${NUGET_AZURE_SOURCE}">
      <package pattern="${pascalScope}.*" />
    </packageSource>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
  </packageSourceMapping>
</configuration>
`
}

/**
 * The portable `node -e` one-liner that installs the fixed Python toolchain
 * (`ruff`/`pytest`/`build`/`twine`) from `requirements-dev.txt`.
 *
 * @remarks
 * Shared bit-for-bit by {@link azurePipelinesYaml} and {@link githubActionsYaml}
 * — one guard script, so the two providers can never drift on what "install
 * Python deps" means. Skips cleanly on a workspace with no Python projects
 * (no `requirements-dev.txt`, written by `add/python.ts` on the first
 * Python `add`).
 *
 * Resolves `python` vs `python3` at run time via `process.platform`, not a
 * hard-coded name: the standard python.org Windows installer registers only
 * `python.exe`, so a build agent on a `windows-latest` (or self-hosted
 * Windows) runner hard-fails immediately on a hard-coded `python3` with
 * "'python3' is not recognized as an internal or external command" — every
 * POSIX system (the assumed default) registers `python3`. Same resolution
 * {@link PYTHON_WORKSPACE_INSTALL_GUARD} and every `@mnci/nx-python-pip`
 * executor use (that package's own `pythonCommand` helper); this guard is a
 * plain generated string, not TypeScript, so it inlines the identical check
 * rather than importing it.
 */
const PYTHON_INSTALL_GUARD = 'node -e "if(!require(\'node:fs\').existsSync(\'requirements-dev.txt\')){console.log(\'No Python projects - skipping.\');process.exit(0)}const py=process.platform===\'win32\'?\'python\':\'python3\';process.exit(require(\'node:child_process\').spawnSync(py+\' -m pip install -r requirements-dev.txt\',{stdio:\'inherit\',shell:true}).status ?? 1)"'

/**
 * The portable `node -e` one-liner that editable-installs every Python
 * project into one shared environment, so cross-project imports resolve at
 * lint/test/dev time — the pip-world counterpart of `npm install` hoisting
 * every workspace package into one root `node_modules`.
 *
 * @remarks
 * Pip has no native workspace protocol (no hoisting, no auto-symlinking of
 * sibling packages), so this is hand-built rather than something pip does on
 * its own: every project with a `pyproject.toml` (`apps/*`, `python-packages/*`,
 * `libs/*` — apps, publishable libs, and internal libs alike) is
 * `pip install -e`'d, and every Azure Function app (`requirements.txt`, no
 * `pyproject.toml` — the shape `@mnci/nx-python-pip`'s `function-application`
 * generator writes) gets `pip install -r`'d, all in **one** `pip install`
 * invocation (not one per project) so the resolver sees every requirement
 * together, same as one `npm install` at the root.
 *
 * This is deliberately broader than the `test` executor's own per-project
 * `pip install -e .` (`@mnci/nx-python-pip`'s `installEditable` option,
 * which only installs the project under test, not what it imports): an
 * internal lib is normally only woven into a consumer at **build** time (the
 * `build` executor's vendoring copy step — see `@mnci/nx-python-pip`'s
 * README), so without this step a project that imports an internal lib
 * cannot resolve that import at test/dev time, only at the final wheel. This
 * step editable-installs the internal lib too, so the import resolves
 * everywhere it is written, not just in the built artifact. It does not
 * change what a published wheel contains — vendoring at build time is
 * unaffected, since pip has no registry-time equivalent of installing an
 * unpublished workspace-only package.
 *
 * Shared bit-for-bit by {@link azurePipelinesYaml} and {@link githubActionsYaml}.
 * Skips cleanly when the workspace has no Python projects. Runs after
 * {@link PYTHON_INSTALL_GUARD} (the fixed dev toolchain), before `sync:check`.
 * Resolves `python` vs `python3` at run time the same way
 * {@link PYTHON_INSTALL_GUARD} does — see its remarks.
 */
const PYTHON_WORKSPACE_INSTALL_GUARD = 'node -e "const fs=require(\'node:fs\'),path=require(\'node:path\');const editableDirs=[...fs.globSync(\'apps/*/pyproject.toml\'),...fs.globSync(\'python-packages/*/pyproject.toml\'),...fs.globSync(\'libs/*/pyproject.toml\')].map((p)=>path.dirname(p));const requirementsFiles=fs.globSync(\'apps/*/requirements.txt\');if(editableDirs.length===0&&requirementsFiles.length===0){console.log(\'No Python projects - skipping.\');process.exit(0)}const args=[\'-m\',\'pip\',\'install\',\'--quiet\',...editableDirs.flatMap((d)=>[\'-e\',d]),...requirementsFiles.flatMap((f)=>[\'-r\',f])];const py=process.platform===\'win32\'?\'python\':\'python3\';process.exit(require(\'node:child_process\').spawnSync(py,args,{stdio:\'inherit\'}).status ?? 1)"'

/**
 * The golangci-lint version every generated workspace installs.
 *
 * @remarks
 * Pinned, like {@link FLUTTER_SDK_VERSION}, for two reasons measured on a real
 * generated workspace (MoNecromanCI/MoNecromanCi#239):
 *
 * - **Reproducibility.** The guard used to `go install …@latest`, so a new
 *   golangci-lint release could add or tighten linters and turn every
 *   workspace's CI red overnight with no change on its side, while a developer's
 *   local copy disagreed with CI.
 * - **Speed.** A pinned version has a published prebuilt binary to download,
 *   instead of a compile. See {@link GOLANGCI_LINT_INSTALL_GUARD}.
 *
 * Bump it deliberately: check the release notes for new default linters, then
 * run the e2e's Go section. Exported so tests and this repo's own workflow can
 * assert it.
 */
export const GOLANGCI_LINT_VERSION = '2.14.0'

/**
 * The Flutter SDK version the generated pipeline installs.
 *
 * @remarks
 * Pinned, like {@link GOLANGCI_LINT_VERSION}, because the Flutter version
 * *determines the Dart version*, and Dart is what has the hard floor here:
 * pub workspaces — the whole basis of mnci's central-dependency model for
 * Dart — need Dart 3.6+. A floating `stable` could in principle move the
 * toolchain under a workspace without warning, so the version is explicit and
 * bumped deliberately.
 *
 * `3.44.8` ships Dart 3.12.2. Exported so tests can assert it and so bumping
 * it is a one-line change.
 */
export const FLUTTER_SDK_VERSION = '3.44.8'

/**
 * The Node major a generated workspace is built and tested against.
 *
 * @remarks
 * Read by both the GitHub workflow's `setup-node` step and the devcontainer's
 * base image, so the environment a contributor develops in cannot silently
 * diverge from the one CI verifies. That drift is the whole reason
 * {@link devcontainerJson} exists, so it must not be reintroduced by hardcoding
 * the number twice.
 *
 * Azure deliberately does not pin it: its pipeline uses whatever Node the agent
 * image ships, which is the existing behaviour and outside this change's scope.
 */
export const NODE_VERSION = '24'

/**
 * The major of each GitHub Action the generated workflow pins.
 *
 * @remarks
 * Pinned here, in one place, because Dependabot cannot see them anywhere else.
 * It keeps THIS repo's `.github/workflows/ci.yml` current — that file is real
 * YAML it can parse — but these are string literals inside a TypeScript
 * generator, invisible to it. So every bump it lands here has to be carried
 * across by hand, and three of the four had not been: this repo ran
 * `checkout@v7`, `setup-node@v7` and `upload-artifact@v7` while every workspace
 * mnci generated still got `@v4`. Only `setup-dotnet` matched, because someone
 * noticed once and ported it (PR #189).
 *
 * The v7 majors are not a guess: they are exactly what this repo's own CI runs
 * green today, on a pipeline whose `run:` steps are asserted to be a superset of
 * the generated one's. `pipeline-drift.integration.spec.ts` now fails when this
 * map falls behind that workflow, so the carry-across is enforced rather than
 * remembered.
 */
export const ACTION_VERSIONS = {
  'actions/checkout':        'v7',
  'actions/setup-node':      'v7',
  'actions/setup-dotnet':    'v6',
  'actions/upload-artifact': 'v7',
  'azure/login':             'v3',
} as const

/**
 * The npm major a generated workspace is built and tested against.
 *
 * @remarks
 * Pinned because npm's own behaviour is part of the contract, not an
 * implementation detail beneath it. npm 11 changed when `overrides` are
 * applied: given a tree that is already installed, it reuses it rather than
 * re-resolving, so an `overrides` entry added after the first install does
 * nothing. Measured on nx 23.1.1 with the same manifest and the same sequence:
 * npm 10.9.7 reported **0** advisories and npm 11.19.0 reported **6**.
 *
 * That divergence is what made the bug expensive. `setup-node` installs
 * whatever npm the Node image happens to bundle, so CI and a contributor's
 * machine could — and did — resolve differently, which meant a local check
 * could pass while the thing it was checking was broken for every user.
 *
 * **The MAJOR is pinned, not an exact version.** The risk this guards is a
 * major behavioural change, which is what actually happened; an exact pin would
 * add a version nothing bumps, and a pin that reads as current while being
 * stale is a failure mode this repo has already paid for once (the
 * `@verdaccio/config` → `js-yaml` entry that read as fixed and was not).
 */
export const NPM_VERSION = '11'

/**
 * The .NET SDK version a generated workspace's C# projects are built and
 * tested against.
 *
 * @remarks
 * `@nx/dotnet` (the official Nx plugin mnci delegates to for C#) requires SDK
 * 8.0+; `10.0.x` is pinned rather than 8.0 because .NET's even-numbered
 * majors are the LTS line (8.0 released Nov 2023, 10.0 Nov 2025) and 10.0 is
 * the current one — the same reasoning `NODE_VERSION` already applies to
 * Node. **Verify the current LTS against the real .NET release notes before
 * this ships**, the way `FLUTTER_SDK_VERSION` was pinned against a real
 * `flutter --version` rather than assumed.
 *
 * The `.x` keeps the range open to patch releases the way `actions/setup-dotnet`
 * and `UseDotNet@2` both expect it (`dotnet-version: '10.0.x'` /
 * `version: '10.0.x'`) — unlike {@link NODE_VERSION}, which is a bare major
 * because `setup-node` resolves majors on its own; .NET's own tooling wants
 * the `.x` suffix explicit.
 *
 * Exported so tests can assert it and both CI providers' install steps and
 * the devcontainer's `dotnet` feature read the same value — the exact drift
 * {@link NODE_VERSION} already exists to prevent for Node.
 */
export const DOTNET_SDK_VERSION = '10.0.x'

/**
 * Detects whether the workspace has any C# project — `apps/*\/*.csproj`,
 * `packages/*\/*.csproj`, `libs/*\/*.csproj`, the same three roots
 * {@link PACK_APPS_GUARD} and `add/csharp.ts` already scan — and publishes
 * the result as an Azure Pipelines variable
 * (`##vso[task.setvariable variable=hasDotnetProjects]`).
 *
 * @remarks
 * Unlike Python, Go and Flutter's provisioning, .NET SDK install is not a
 * portable `node -e` one-liner: `UseDotNet@2` / `actions/setup-dotnet` are
 * each provider's own maintained, cached installer, and hand-rolling a
 * cross-platform equivalent of either would be strictly worse than using
 * them — the same trade already made for Node/npm setup itself, which is
 * fully provider-specific (`actions/setup-node` + `cache: npm` vs. Azure's
 * pre-installed image Node plus a separate `Cache@2` task). So this constant
 * exists only to give the Azure *task* something to gate on: unlike a
 * `script:` step, `UseDotNet@2` cannot self-gate by exiting early, and
 * Azure's `condition:` expression language has no glob-matching function —
 * where GitHub Actions' `hashFiles()` covers the same case inline (see
 * {@link githubActionsYaml}), Azure needs this detection step to run first
 * and hand the answer to `condition:` through a variable.
 *
 * Both the pattern list and the `##vso` syntax are copied from
 * {@link PACK_APPS_GUARD}'s sibling `build.addbuildtag` usage further down
 * this file — the same "publish a fact for a later step" mechanism, just
 * read by `condition:` instead of by a human.
 */
const DOTNET_DETECT_AZURE = 'node -e "const fs=require(\'node:fs\');const has=[...fs.globSync(\'apps/*/*.csproj\'),...fs.globSync(\'packages/*/*.csproj\'),...fs.globSync(\'libs/*/*.csproj\')].length>0;console.log(\'##vso[task.setvariable variable=hasDotnetProjects]\'+has)"'

/**
 * The Nx targets every CI run verifies.
 *
 * @remarks
 * `typecheck` is not covered by `build`: a bundler-built project (esbuild, swc)
 * strips types without reading them, so a workspace can be green on
 * lint+test+build while carrying real type errors.
 *
 * Exported because `mnci ci verify` runs the same list: the pipeline and the command it
 * is being moved into must not be able to disagree about what verified means.
 */
export const VERIFY_TARGETS = 'lint,typecheck,test,build'

/**
 * The Nx targets a native job runs on each OS: lint, test, then build and package for that host.
 *
 * @remarks
 * Shared by the generated pipelines and `mnci ci native`, so the two cannot name different targets.
 */
export const NATIVE_TARGETS = 'lint,test,build-native,package-native'

/**
 * The GitHub Actions `native` job: one leg per OS, for apps that need a C toolchain.
 *
 * @remarks
 * `needs: ci`, so on a push to main the release has already tagged by the time the
 * legs run, which is what lets each one attach its own platform's zip to the GitHub
 * Release (`tools/go-app-release.cjs assets --native`). `fail-fast` is off because a
 * Linux packaging failure says nothing about the macOS leg.
 *
 * @param npmAuthName - The environment variable `npm ci` reads its registry token from.
 * @param npmAuthValue - The GitHub Actions expression that supplies it.
 * @param runners - The runner label of each leg.
 * @returns The job, as YAML starting with a newline, to append under `jobs:`.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
function githubNativeJob (npmAuthName: string, npmAuthValue: string, runners: readonly string[]): string {
  return `
  # Apps that need a C toolchain (mnci add go-app --cgo) cannot be cross-compiled
  # from the job above, so each is linted, tested, built and packaged here, on a
  # runner of every OS it ships for, and is left out of that job's verify step.
  native:
    name: native (\${{ matrix.os }})
    needs: ci
    runs-on: \${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [${runners.join(', ')}]
    steps:
      - uses: actions/checkout@${ACTION_VERSIONS['actions/checkout']}
        with:
          fetch-depth: 0

      # The release tags name the version a native build is stamped with.
      - run: git fetch --all --prune --tags
        name: Fetch branches and release tags

      - uses: actions/setup-node@${ACTION_VERSIONS['actions/setup-node']}
        with:
          node-version: ${NODE_VERSION}
          cache: npm

      - run: npm install -g npm@${NPM_VERSION}
        name: Pin npm to the major mnci verifies against

      - run: npm ci
        name: Install dependencies
        env:
          ${npmAuthName}: ${npmAuthValue}

      # The Go toolchain: the modules, and a checksum-verified golangci-lint put
      # on PATH. The other toolchains are skipped cleanly when absent.
      - run: npx mnci ci setup
        name: Set up the Go toolchain

      # Lints, tests, builds and packages the native apps on this OS. On a Linux leg it
      # first installs a C compiler, pkg-config and the packages of mnci.native.linuxPackages
      # in nx.json (for a tray icon: libgtk-3-dev, libayatana-appindicator3-dev). On a push to
      # main, a releasable native app (--cgo with --release) also gets this OS's zip
      # attached to the GitHub Release the ci job just created, stamped with the
      # tag's version.
      - run: npx mnci ci native
        name: Lint, test, build and package the native apps
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}

      - uses: actions/upload-artifact@${ACTION_VERSIONS['actions/upload-artifact']}
        with:
          name: native-\${{ matrix.os }}
          path: dist/drop
          if-no-files-found: ignore
`
}

/**
 * Indents every non-blank line of a YAML fragment.
 *
 * @param text - The fragment.
 * @param spaces - How many spaces to add.
 * @returns The fragment with blank lines left empty, so no trailing whitespace appears.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
function indentYaml (text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)

  return text.split('\n').map(line => (line === '' ? line : pad + line)).join('\n')
}

/**
 * Rewrites a single-job Azure pipeline as two jobs: the original, then the native one.
 *
 * @remarks
 * The generated pipeline has `pool:` and `steps:` at the top level, which Azure
 * reads as one implicit job. A second job needs the explicit form, so the three
 * top-level blocks (`pool`, `variables`, `steps`) are cut out and the first and last
 * moved under `- job: ci`, untouched but for the indentation. Only a workspace with a
 * native app takes this path, so every other workspace keeps the file it has.
 *
 * @param document - The single-job pipeline from {@link azurePipelinesYaml}.
 * @param nativeSteps - The native job's steps, written at the top-level steps indentation.
 * @param runners - The VM image of each leg.
 * @returns The two-job pipeline.
 * @throws Error when the pipeline no longer has its `pool:`, `variables:` and `steps:` blocks in that order.
 * @typeParam None - this function has no generic type parameters.
 */
function withAzureNativeJob (document: string, nativeSteps: string, runners: readonly string[]): string {
  const poolAt = document.indexOf('\npool:\n')
  const variablesAt = document.indexOf('\nvariables:\n')
  const stepsAt = document.indexOf('\nsteps:\n')
  if (poolAt === -1 || variablesAt < poolAt || stepsAt < variablesAt) {
    throw new Error('The Azure pipeline no longer has its pool, variables and steps blocks in that order.')
  }
  const head = document.slice(0, poolAt + 1)
  const pool = document.slice(poolAt + '\npool:\n'.length, variablesAt).replace(/\n+$/, '')
  const variables = document.slice(variablesAt + 1, stepsAt).replace(/\n+$/, '')
  const steps = document.slice(stepsAt + '\nsteps:\n'.length).replace(/\n+$/, '')
  const matrix = runners
    .map(image => ({ leg: image.replaceAll(/\W/g, '_'), image }))
    .map(({ leg, image }) => `        ${leg}:\n          legName: ${leg}\n          vmImage: ${image}`)
    .join('\n')

  return `${head}${variables}

jobs:
  - job: ci
    pool:
${indentYaml(pool, 4)}
    steps:
${indentYaml(steps, 4)}

  # Apps that need a C toolchain (mnci add go-app --cgo) cannot be cross-compiled
  # from the job above, so each is linted, tested, built and packaged here, on an
  # agent of every OS it ships for, and is left out of that job's verify step.
  - job: native
    displayName: Native apps (cgo)
    dependsOn: ci
    strategy:
      matrix:
${matrix}
    pool:
      vmImage: $(vmImage)
    steps:
${indentYaml(nativeSteps, 4)}
`
}

/**
 * The env var each registry kind carries a PyPI-side credential in.
 *
 * @remarks
 * Deliberately NOT the same variable as npm's. Azure Artifacts' feed is
 * multi-protocol, so one PAT authenticates both; public npm and public PyPI
 * are unrelated services with unrelated credentials, and conflating them is
 * how a workspace ends up sending its npm automation token to PyPI.
 */
export const PYPI_TOKEN_VARIABLE = 'PYPI_TOKEN'

/**
 * The env var an Azure Artifacts workspace carries its base64-encoded PAT in.
 *
 * @remarks
 * Named once and shared by {@link npmAuthEnvVariable},
 * {@link pythonPublishEnvFragment} and {@link nugetPublishEnvFragment}, for the
 * same "cannot drift between providers" reason {@link PYPI_TOKEN_VARIABLE} is a
 * constant rather than three string literals.
 */
export const AZURE_PAT_VARIABLE = 'PAT'

/**
 * The extra `env:` line the release step needs to carry a PyPI token.
 *
 * @remarks
 * Only for the public-npm registry kind. An Azure Artifacts feed publishes
 * Python through the SAME multi-protocol feed and the same PAT the step
 * already exports, so adding a second variable there would suggest a second
 * credential exists when it does not.
 *
 * Rendered from one function for both providers, so the variable name cannot
 * drift between them - the same reason {@link npmAuthEnvVariable} exists.
 *
 * @param registryKind - The workspace's registry kind.
 * @param variableReference - Renders a named secret in the calling provider's
 * own syntax (Azure `$(NAME)`, GitHub `${{ secrets.NAME }}`).
 * @param indent - The indentation the provider's `env:` block uses.
 * @returns The rendered line, or `''` when no PyPI token applies.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
function pypiTokenEnvLine (
  registryKind: RegistryConfig['kind'],
  variableReference: (name: string) => string,
  indent: string,
): string {
  return registryKind === 'npm'
    ? `
${indent}${PYPI_TOKEN_VARIABLE}: ${variableReference(PYPI_TOKEN_VARIABLE)}`
    : ''
}

/**
 * The env var name + value pair that authenticates `npm ci`/`nx release publish`,
 * keyed by registry kind — two genuinely different secrets, never conflated.
 *
 * @remarks
 * Azure Artifacts' `.npmrc` (`npmrcContent`) reads a base64-encoded PAT via
 * `${PAT}`; public npm's reads a raw npm automation token via
 * `${NODE_AUTH_TOKEN}`. Before this, both {@link azurePipelinesYaml} and
 * {@link githubActionsYaml} always exported `PAT` regardless of registry —
 * harmless for Azure Artifacts, but silently non-functional for public npm
 * (nothing ever populated `NODE_AUTH_TOKEN`, so a public-npm workspace's CI
 * could build and version but never actually authenticate a publish).
 *
 * @param registryKind - The workspace's registry kind.
 * @param variableReference - Renders a named secret/variable in the calling
 * provider's own syntax (Azure `$(NAME)`, GitHub `${{ secrets.NAME }}`).
 * @returns A `[envVarName, value]` pair to render under the step's `env:` block.
 * @throws Never - pure mapping.
 * @typeParam None - this function has no generic type parameters.
 */
function npmAuthEnvVariable (
  registryKind: RegistryConfig['kind'],
  variableReference: (name: string) => string,
): [string, string] {
  return registryKind === 'npm'
    ? ['NODE_AUTH_TOKEN', variableReference('NPM_TOKEN')]
    : [AZURE_PAT_VARIABLE, variableReference(AZURE_PAT_VARIABLE)]
}

/**
 * Renders the `pool:` block body for a chosen build agent.
 *
 * @remarks
 * One CLI value drives it: Microsoft-hosted images start `ubuntu-`/`windows-`/
 * `macos-` (`ubuntu-latest`, `windows-2022`, `macos-13`, …) → `vmImage`;
 * anything else is treated as a self-hosted pool name → `name`. Either way the
 * pipeline's steps are OS-agnostic, so it runs unchanged on the chosen agent.
 *
 * @param agent - The vmImage or self-hosted pool name.
 * @returns The two-space-indented `pool:` child line.
 * @throws Never - pure string mapping.
 * @typeParam None - this function has no generic type parameters.
 */
export function poolBlock (agent: string): string {
  return /^(?:ubuntu|windows|macos)-/i.test(agent) ? `  vmImage: ${agent}` : `  name: ${agent}`
}

/**
 * Builds the generated workspace's whole CI: one short Azure Pipelines file.
 *
 * @remarks
 * Runs unchanged on ANY agent OS (Linux, macOS, Windows): no bash, no
 * PowerShell — every step is a built-in task or a single-line
 * `git`/`npm`/`npx`/`node` command `cmd.exe` and `sh` execute identically.
 *
 * Every run first checks `nx sync:check` — a fast, explicit failure when
 * someone forgot to run `nx sync` (and commit the result) after adding a
 * cross-project import. `sync.applyChanges` in `nx.json` ({@link SYNC_CONFIG})
 * means that locally this almost never happens: Nx auto-applies the fix on the
 * next build/typecheck instead of just prompting.
 *
 * On `main` (non-PR) the pipeline: **packs every app** into `dist/drop/` as one
 * zip per app named `<type>-<name>.zip` (each app owns an `nx` `package`
 * target — {@link runAdd}), publishes `dist/drop` as the **`drop`** artifact,
 * emits one **build tag per app** (`##vso[build.addbuildtag]<type>-<name>`,
 * derived from the zip filenames so it is *exactly* the zip name — the classic
 * release/CD pipeline keys off it), then `nx release`s: **publish packages +
 * tag main** (versions from conventional commits, tag-only push).
 *
 * npm auth is one of two modes ({@link NpmAuthMode}). By default it is the base64
 * PAT from the `variableGroup` (default `Build`): the group exposes `$(PAT)`,
 * mapped as env on the npm steps and read by the root `.npmrc`'s `_password`
 * block, and `npmAuthenticate@0` is NOT used because it would overwrite that
 * password. With `build-identity` the file holds no password, so the task is added
 * before `npm ci` and injects the build service identity's token instead.
 *
 * Hard-won Azure lessons carried over:
 * - `checkout: self` detaches HEAD; re-attach with `git checkout -B` first or
 *   `nx release` cannot push tags.
 * - Fetch all refs + tags up front (version resolution needs the tags).
 * - A git identity is required to create annotated tags on CI.
 * - One-time grants (project admin): *Project Collection Build Service* needs
 *   *Contribute* on the repo (tag push); the PAT's owner needs feed *publish*.
 *
 * `nx release` versions BOTH `packages/*` (npm) and `python-packages/*`
 * (Python) from conventional commits and tags each — one unified release. When
 * `pythonPublishUrl` is set (Azure Artifacts — {@link pythonPublishUrl}), the
 * release step also exports `TWINE_*` so `nx release` publishes the Python
 * packages with `twine`, reusing the base64 `PAT` decoded to the raw token
 * twine/pypi basic-auth needs (no second secret; Azure accepts any username).
 * For the public-npm registry that env is omitted, so a Python package there
 * is still versioned + tagged but its publish needs user-provided `TWINE_*`.
 * Before any Python target runs, one guarded step installs the fixed toolchain
 * (`ruff`/`pytest`/`build`/`twine`) from the workspace's `requirements-dev.txt`
 * — written by `add/python.ts` on the first Python `add` — and a second
 * editable-installs every Python project into that same environment (the
 * pip-world counterpart of `npm install` hoisting every workspace package
 * into one root `node_modules`); both are skipped cleanly on a workspace with
 * no Python projects.
 *
 * @param agent - The build agent (vmImage or self-hosted pool name).
 * @param variableGroup - The Library variable group holding the base64 `PAT`.
 * @param pythonPublishUrl - The twine upload URL for Python packages, or
 * `undefined` to leave Python publishing unconfigured (public npm).
 * @param registryKind - The workspace's registry kind — selects `PAT` vs
 * `NPM_TOKEN` for the npm-authenticating steps.
 * @param nugetFeedUrl - The NuGet v3 feed URL for C# packages, or
 * `undefined` to leave NuGet publishing unconfigured (public npm).
 * @param npmAuth - `build-identity` adds the `npmAuthenticate@0` step before
 * `npm ci` and drops the `PAT` mapping from that step; `pat` keeps both as they were.
 * @returns The full text of `azure-pipelines.yml`.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function azurePipelinesYaml (
  agent: string,
  variableGroup: string,
  pythonPublishUrl?: string,
  registryKind: RegistryConfig['kind'] = 'azure-artifacts',
  nugetFeedUrl?: string,
  npmAuth: NpmAuthMode = 'pat',
  nativeApps = false,
  nativeRunners: readonly string[] = DEFAULT_NATIVE_RUNNERS,
): string {
  // ENUMERATED CI reasons, never "not a pull request" — the Azure half of the
  // fix #22 made for GitHub, and the more exposed of the two.
  //
  // `ne(Build.Reason, 'PullRequest')` admits every reason that is not a PR, and
  // Azure documents EIGHT of those: Manual, Schedule, IndividualCI, BatchedCI,
  // BuildCompletion, ResourceTrigger, ValidateShelveset and CheckInShelveset. So
  // clicking *Run pipeline* on `main` — an ordinary Azure workflow, not an
  // exotic one — would publish packages and push release tags. GitHub's
  // equivalent needed someone to add a trigger first; this one never did.
  //
  // BOTH CI reasons are listed, and dropping either is a silent failure in the
  // opposite direction — releases would simply stop, with a green pipeline.
  // `BatchedCI` is the one that matters here: the trigger above sets
  // `batch: true`, and Azure documents BatchedCI as the reason for "a Git push
  // ... and the Batch changes was selected". `IndividualCI` stays because
  // batching only applies once a run is already in progress, so an unbatched
  // push is still the ordinary case.
  //
  // Verified against Microsoft's own docs rather than assumed: `in()` is
  // "Evaluates True if left parameter is equal to any right parameter", min 1 /
  // max N — and Azure defines a step's own `succeeded()` as
  // `in(variables['Agent.JobStatus'], ...)`, so it is valid in a step condition.
  const onMain = 'and(succeeded(), in(variables[\'Build.Reason\'], \'IndividualCI\', \'BatchedCI\'), eq(variables[\'Build.SourceBranchName\'], \'main\'))'
  const [npmAuthName, npmAuthValue] = npmAuthEnvVariable(registryKind, name => `$(${name})`)
  // Build-identity auth only exists for an Azure Artifacts feed; public npm has
  // nothing for the task to inject, so the mode is ignored there.
  const buildIdentity = npmAuth === 'build-identity' && registryKind === 'azure-artifacts'
  const npmAuthenticateStep = buildIdentity
    ? `  # Injects feed credentials into .npmrc using the BUILD SERVICE IDENTITY, so no
  # PAT is stored, rotated or encoded anywhere. This is what the feed accepts: its
  # publish endpoint advertises a Bearer scheme bound to login.windows.net, which
  # wants an Entra ID access token, and a PAT is not one. Must run before 'npm ci'.
  # Needs the build identity to be a Feed Publisher (Contributor) on the feed.
  - task: npmAuthenticate@0
    displayName: Authenticate npm against the feed (build identity, no PAT)
    inputs:
      workingFile: .npmrc

`
    : ''
  const npmCiEnv = buildIdentity
    ? ''
    : `
    env:
      ${npmAuthName}: ${npmAuthValue}`

  const document = `name: monorepo-ci-$(Date:yyyyMMdd)$(Rev:.r)

# Generated by MoNecromanCI. Deliberately thin: Nx builds, 'nx release'
# versions from conventional commits and pushes ONLY a tag to main, and each
# app is packed into dist/drop/<type>-<name>.zip by its own 'package' target.
#
# Cross-platform by construction: no bash, no PowerShell. Every step is a
# built-in task or a single-line git/npm/npx/node command, so the pipeline
# runs unchanged on Linux, macOS and Windows agents.

trigger:
  # While a run is in progress, queue further pushes and run them together rather
  # than concurrently. This is the closest thing Azure Pipelines YAML has to
  # GitHub's concurrency group, and it is load-bearing on main for the same
  # reason: two concurrent 'nx release' runs would race to create the same tag.
  batch: true
  branches:
    include:
      - main
      # EVERY other branch too, and that breadth is a correction rather than
      # generosity. On Azure Repos Git a YAML 'pr:' block does nothing at all
      # (see the note below), so a CI trigger is the only pre-merge
      # verification this file can switch on by itself. Listing main alone —
      # which is what this pipeline used to do, next to a 'pr:' block that
      # looked like it covered the rest — means a workspace verifies NOTHING
      # until a change has already reached the branch it was supposed to
      # protect.
      #
      # Release stays gated on main (the 'condition:' on every release step
      # below), so a topic-branch run installs, audits, syncs, formats,
      # verifies and packs, and publishes nothing.
      - '*'

# PR validation is deliberately NOT configured here, because on Azure Repos Git
# it CANNOT be: "For an Azure Repos Git repo, you cannot configure a PR trigger
# in the YAML file. You need to use branch policies." A 'pr:' block here is not
# an error — it is silently ignored, which is worse, because the file then
# documents a gate that does not exist. (The same block IS honoured for GitHub
# and Bitbucket repos, which is why .github/workflows/ci.yml keeps its
# 'pull_request:' trigger.)
#
# To get PR validation, configure it once in the UI: Project Settings ->
# Repositories -> <repo> -> Policies -> <branch> -> Build Validation, pointing
# at this pipeline. That is also the only thing that sets
# System.PullRequest.TargetBranch, which the verify step below reads to scope
# itself to affected projects — without a policy that variable is never set and
# the step verifies every project instead. Correct either way, just slower.
#
# Cancelling a superseded PR run lives in that same policy ("automatically
# cancel"), and likewise has no YAML expression.
pr: none

pool:
${poolBlock(agent)}

variables:
  # Holds the npm auth secret the root .npmrc reads: the base64-encoded \`PAT\`
  # for an Azure Artifacts feed, or a raw npm automation token as \`NPM_TOKEN\`
  # for public npm. Mark it secret in Library. Add app build vars here too if needed.
  - group: ${variableGroup}
  # Relocates npm's cache inside the pipeline workspace so Cache@2 can restore it
  # (the default ~/.npm is outside the cacheable area on hosted agents). npm reads
  # this as an ordinary env var, so it needs no config file and works on every
  # agent OS.
  - name: npm_config_cache
    value: $(Pipeline.Workspace)/.npm
  # Overrides the bump nx would compute from conventional commits for one
  # release run — 'major', 'minor', 'patch', or an exact version ('1.2.3').
  # Defined here (rather than left unset) so $(RELEASE_SPECIFIER) always
  # expands: an Azure Pipelines macro that names an undefined variable is
  # left as the literal, unexpanded text '$(RELEASE_SPECIFIER)' rather than
  # empty, which would otherwise reach the release guard below as a bogus
  # value. Override it per run in Pipelines -> Run pipeline -> Variables, or
  # set a repo-level default in Pipeline -> Edit -> Variables. See the
  # release step below for why a bare keyword is unreliable once more than
  # one package is releasable.
  - name: RELEASE_SPECIFIER
    value: ''

steps:
  - checkout: self
    # Lets later steps push release tags back to the repo. The Project
    # Collection Build Service account needs Contribute permission on this
    # repo (Project Settings -> Repositories -> Security) — one-time grant.
    persistCredentials: true
    fetchDepth: 0

  # checkout leaves a detached HEAD; nx release needs a real branch.
  - script: git checkout -B $(Build.SourceBranchName)
    displayName: Attach HEAD to the source branch

  # Version resolution needs the release tags.
  - script: git fetch --all --prune --tags
    displayName: Fetch branches and release tags

  - script: git config user.name "Azure Pipelines" && git config user.email "pipeline@dev.azure.com"
    displayName: Set the git identity used for release tags

  - task: UseNode@1
    inputs:
      version: 24.x

  # The Azure counterpart of \`cache: npm\` on actions/setup-node: restores npm's
  # download cache so \`npm ci\` does not re-fetch every tarball on every run.
  # Keyed on the lockfile, so a dependency change misses and anything else hits;
  # restoreKeys falls back to the newest cache for this OS on a miss, which still
  # avoids a fully cold install. Agent.OS is in the key because a cached native
  # module built for one OS is not reusable on another.
  - task: Cache@2
    displayName: Cache npm packages
    inputs:
      key: 'npm | "$(Agent.OS)" | package-lock.json'
      restoreKeys: |
        npm | "$(Agent.OS)"
      path: $(npm_config_cache)

${npmAuthenticateStep}  - script: npm ci
    displayName: Install dependencies${npmCiEnv}

${slotMarkers('after-install', '  ')}

  # Everything from here to the release is a command of the mnci CLI, a
  # devDependency of this workspace, so the version is the lockfile's and a
  # developer reproduces CI by running the same line. The guards that used to be
  # inline here are tested TypeScript in the CLI's ci-pipeline slice. Node, the
  # checkout and 'npm ci' stay above: Node must exist before 'npx' can run.

  # The language toolchains the workspace needs: Python (ruff, pytest, build,
  # twine, and every project installed into one shared environment), Go (the
  # modules and a checksum-verified golangci-lint, put on PATH) and Flutter (the
  # pinned SDK, put on PATH, and one pub get). Each is skipped cleanly when the
  # workspace has no project in that language.
  - script: npx mnci ci setup
    displayName: Set up the language toolchains (Python, Go, Flutter)

  # Fails ONLY on an advisory that has a published fix, at moderate or above;
  # anything upstream has not fixed is printed and passes. pip-audit only
  # reports: its output has no "a fix exists" field to draw that line with.
  - script: npx mnci ci audit
    displayName: Audit dependencies (fails on an actionable npm advisory)

  # .NET, if the workspace has any. Azure's 'condition:' expression language
  # has no glob function, so this script step detects C# projects first and
  # hands the answer to the install task below through a pipeline variable —
  # see DOTNET_DETECT_AZURE's remarks for why this differs from every other
  # toolchain's self-gating 'node -e' guard.
  - script: ${DOTNET_DETECT_AZURE}
    displayName: Detect .NET projects

  - task: UseDotNet@2
    displayName: Install the .NET SDK (${DOTNET_SDK_VERSION})
    condition: eq(variables['hasDotnetProjects'], 'true')
    inputs:
      version: ${DOTNET_SDK_VERSION}

  # Fails fast on a stale TypeScript project reference, then the one verify
  # step, and deliberately the only one: affected projects on a pull request,
  # EVERY project on anything else (a push to main included, so a release is
  # always verified in full). Every fallback takes the full path, because a run
  # that verifies too little still reports green. Apps that need a C toolchain
  # are left to the native job.
  - script: npx mnci ci verify
    displayName: Verify (sync check, then affected on a PR, every project on main)

${phaseStart('pack', '  ')}
  # Pack every app into dist/drop/<type>-<name>.zip via each app's 'package'
  # target; skipped cleanly when the workspace has no apps yet.
  - script: npx mnci ci pack
    displayName: Pack all apps (one zip per app -> dist/drop)
    condition: ${onMain}

  - task: PublishBuildArtifacts@1
    displayName: Publish the drop (one zip per app)
    condition: ${onMain}
    inputs:
      PathtoPublish: $(Build.SourcesDirectory)/dist/drop
      ArtifactName: drop

  # One build tag per packed app, EXACTLY the zip name (type-name), so the
  # classic release pipeline knows which app to run for. Derived from the zip
  # filenames so the tag can never drift from the artifact.
  - script: node -e "const fs=require('node:fs');const path=require('node:path');for(const f of fs.globSync('dist/drop/*.zip')){console.log('##vso[build.addbuildtag]'+path.basename(f,'.zip'))}"
    displayName: Tag the run per app (type-name)
    condition: ${onMain}
${phaseEnd('pack', '  ')}

${slotMarkers('before-release', '  ')}

${phaseStart('release', '  ')}
  # The release, in the order that keeps a failure safe: refuse a shallow
  # clone, prove the npm token and name the PyPI projects it would create (all
  # BEFORE anything is tagged), then version + tag + publish in one 'nx release'
  # for npm, Python, C# and VS Code, then push the tags explicitly (nx release's
  # own push never runs without a remote GitHub/GitLab Release configured, which
  # this pipeline never does). Which registry is in use is read from the 'mnci'
  # block of nx.json, not baked into this file. The secrets are mapped here, in
  # the one place a command cannot reach.
  #
  # RELEASE_SPECIFIER (the pipeline variable above) overrides the bump nx would
  # compute from conventional commits for THIS run: 'major', 'minor', 'patch', or
  # an exact version ('1.2.3'). With more than one releasable package a bare
  # keyword is unreliable (nx versions interdependent packages in two passes, and
  # the second computes from a version cached before the first), so the command
  # fails the run rather than under-bumping silently: prefer an exact version,
  # and clear the variable back to '' once the override is no longer needed.
  - script: npx mnci ci release
    displayName: Release — version, tag and publish (npm + Python + C# + VS Code)
    condition: ${onMain}
    env:
      ${npmAuthName}: ${npmAuthValue}${pypiTokenEnvLine(registryKind, name => `$(${name})`, ' '.repeat(6))}
      RELEASE_SPECIFIER: $(RELEASE_SPECIFIER)
      # A VS Code extension publishes with it; tools/vscode-extension.cjs skips the
      # Marketplace when it is unset, including when Azure leaves it as '$(VSCE_PAT)'.
      VSCE_PAT: $(VSCE_PAT)
${phaseEnd('release', '  ')}

${slotMarkers('after-release', '  ')}
`
  if (!nativeApps) {
    return document
  }
  // Written at the top-level steps indentation, like the steps above, and moved under
  // its job by withAzureNativeJob. Azure has no GitHub Release to attach to, so the
  // legs publish their zips as pipeline artifacts and stop there.
  const nativeSteps = `  - checkout: self
    fetchDepth: 0

  - task: UseNode@1
    inputs:
      version: 24.x

  - task: Cache@2
    displayName: Cache npm packages
    inputs:
      key: 'npm | "$(Agent.OS)" | package-lock.json'
      restoreKeys: |
        npm | "$(Agent.OS)"
      path: $(npm_config_cache)

${npmAuthenticateStep}  - script: npm ci
    displayName: Install dependencies${npmCiEnv}

  # The Go toolchain: the modules, and a checksum-verified golangci-lint put on
  # PATH. The other toolchains are skipped cleanly when absent.
  - script: npx mnci ci setup
    displayName: Set up the Go toolchain

  # On a Linux leg this first installs a C compiler, pkg-config and the packages of
  # mnci.native.linuxPackages in nx.json (for a tray icon: libgtk-3-dev,
  # libayatana-appindicator3-dev). macOS and Windows agents ship their toolchains.
  - script: npx mnci ci native
    displayName: Lint, test, build and package the native apps

  - task: PublishBuildArtifacts@1
    displayName: Publish this OS's native zips
    inputs:
      PathtoPublish: $(Build.SourcesDirectory)/dist/drop
      ArtifactName: native-$(legName)
`

  return withAzureNativeJob(document, nativeSteps, nativeRunners)
}

/**
 * Builds the generated workspace's whole CI as a GitHub Actions workflow —
 * the GitHub-hosted equivalent of {@link azurePipelinesYaml}.
 *
 * @remarks
 * Same pipeline, same shared guard scripts ({@link PYTHON_INSTALL_GUARD},
 * {@link PYTHON_WORKSPACE_INSTALL_GUARD}, {@link PIP_AUDIT_GUARD},
 * {@link NPM_AUDIT_STEP}, {@link PACK_APPS_GUARD}, {@link releaseGuard}) —
 * only the provider syntax differs, so the two YAML files can never drift on
 * what CI actually does.
 * Two steps from the Azure version are dropped, both for reasons already
 * documented there:
 * - **Attach HEAD to a branch**: `actions/checkout` (unlike Azure's
 *   `checkout: self`) already leaves a push-triggered run on the real branch,
 *   not a detached HEAD, so there is nothing to re-attach.
 * - **Tag the run per app**: `##vso[build.addbuildtag]` is an Azure classic
 *   Release-pipeline mechanism with no GitHub Actions equivalent; the `drop`
 *   artifact (one zip per app inside it) is the portable substitute.
 *
 * Auth is a single repository (or environment) secret — `PAT` for an Azure
 * Artifacts feed, or `NPM_TOKEN` (a raw npm automation token) for public npm
 * — GitHub has no "variable group" concept, so unlike the Azure version this
 * needs no CLI-collected name, just a secret the user creates once in the
 * repo settings, read here as `secrets.PAT`/`secrets.NPM_TOKEN`.
 * `permissions: contents: write` is what lets the checkout's own token push
 * the release tag back (no `persistCredentials` step to opt into — GitHub's
 * checkout wires this up from the job's `permissions` automatically).
 *
 * @param agent - The build agent — reused as-is for `runs-on:` (GitHub's
 * hosted runner labels, e.g. `ubuntu-latest`, already match the common Azure
 * vmImage names; anything else is passed through as a self-hosted runner
 * label).
 * @param pythonPublishUrl - The twine upload URL for Python packages, or
 * `undefined` to leave Python publishing unconfigured (public npm).
 * @param registryKind - The workspace's registry kind — selects `PAT` vs
 * `NPM_TOKEN` for the npm-authenticating steps.
 * @param ci - Which CI provider(s) the workspace generates a pipeline for.
 * @param nugetFeedUrl - The NuGet v3 feed URL for C# packages, or
 * `undefined` to leave NuGet publishing unconfigured (public npm).
 * @returns The full text of `.github/workflows/ci.yml`.
 * @throws Never - performs a pure mapping with no I/O.
 * @typeParam None - this function has no generic type parameters.
 */
export function githubActionsYaml (
  agent: string,
  pythonPublishUrl?: string,
  registryKind: RegistryConfig['kind'] = 'azure-artifacts',
  ci: CiProvider = 'github',
  nugetFeedUrl?: string,
  nativeApps = false,
  nativeRunners: readonly string[] = DEFAULT_NATIVE_RUNNERS,
): string {
  // `== 'push'`, not `!= 'pull_request'`. Identical today — the generated workflow
  // has exactly two triggers, `push` and `pull_request` — but the negative form
  // says "anything that is not a PR", which quietly means "and any trigger anyone
  // adds later". Add a `workflow_dispatch` or a `schedule` to a workflow written
  // the negative way and clicking *Run workflow* starts publishing packages and
  // pushing release tags, with nothing in the file hinting that it would.
  //
  // Not hypothetical: mnci's own workflow hand-added `workflow_dispatch` for its
  // Windows e2e job and inherited exactly that hazard. The positive form states
  // the actual intent — release on a push to main — and cannot be widened by
  // accident.
  const onMain = 'github.event_name == \'push\' && github.ref_name == \'main\''
  const [npmAuthName, npmAuthValue] = npmAuthEnvVariable(
    registryKind,
    name => `\${{ secrets.${name} }}`,
  )
  // Matches releaseConfig(ci)'s own condition exactly — GitHub Release
  // creation (and therefore Nx's own tag push) is only ever on when GitHub
  // Actions is the *only* configured provider; see releaseConfig's remarks.
  const githubReleases = ci === 'github'

  return `name: CI

# Generated by MoNecromanCI. Deliberately thin: Nx builds, 'nx release'
# versions from conventional commits and pushes ONLY a tag to main, and each
# app is packed into dist/drop/<type>-<name>.zip by its own 'package' target.
# The GitHub Actions equivalent of azure-pipelines.yml — see there for the
# fuller rationale; both stay hand-kept in lockstep, there is no shared template.

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  # One run at a time per ref, but \`cancel-in-progress\` is an **expression** on
  # purpose rather than a flat \`true\`.
  #
  # A superseded PR run is pure waste, so cancel it. A run on \`main\` must never
  # be cancelled: it publishes packages and pushes release tags, and killing it
  # part-way can leave a tag pushed with the publish only half done — a state no
  # rerun repairs cleanly, because the version is then already tagged. Those runs
  # queue instead, which also stops two \`nx release\` invocations racing to create
  # the same tag when two commits land close together.
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

permissions:
  # Lets the release step push the version tag nx release creates back to main,
  # and (github-only provider) create the GitHub Release itself.
  contents: write
  # Lets azure/login exchange this job's OIDC token for a Microsoft Entra ID one,
  # which is how a VS Code extension reaches the Marketplace with no stored secret.
  # A token minted on a pull request cannot use it: the federated credential is
  # pinned to refs/heads/main.
  id-token: write

jobs:
  ci:
    runs-on: ${agent}
    steps:
      - uses: actions/checkout@${ACTION_VERSIONS['actions/checkout']}
        with:
          fetch-depth: 0

      # Version resolution needs the release tags.
      - run: git fetch --all --prune --tags
        name: Fetch branches and release tags

      - run: git config user.name "github-actions[bot]" && git config user.email "github-actions[bot]@users.noreply.github.com"
        name: Set the git identity used for release tags

      - uses: actions/setup-node@${ACTION_VERSIONS['actions/setup-node']}
        with:
          node-version: ${NODE_VERSION}
          # Caches ~/.npm keyed on package-lock.json, so \`npm ci\` restores from
          # the local cache instead of re-downloading every tarball on every run.
          # Nothing to invalidate by hand: the action keys on the lockfile, so a
          # dependency change misses the cache and a no-op change hits it.
          cache: npm

      # setup-node installs whatever npm the Node image bundles, and npm's major
      # is part of the contract: npm 11 reuses an already-installed tree instead
      # of re-resolving, so it applies \`overrides\` differently from npm 10. See
      # NPM_VERSION's remarks for the measurement.
      - run: npm install -g npm@${NPM_VERSION}
        name: Pin npm to the major mnci verifies against

      - run: npm ci
        name: Install dependencies
        env:
          ${npmAuthName}: ${npmAuthValue}

${slotMarkers('after-install', ' '.repeat(6))}

      # Everything from here to the release is a command of the mnci CLI, a
      # devDependency of this workspace, so the version is the lockfile's and a
      # developer reproduces CI by running the same line. The guards that used to be
      # inline here are tested TypeScript in the CLI's ci-pipeline slice. Node,
      # the checkout and 'npm ci' stay above: Node must exist before 'npx' can run.

      # The language toolchains the workspace needs: Python (ruff, pytest, build,
      # twine, and every project installed into one shared environment), Go (the
      # modules and a checksum-verified golangci-lint, put on PATH) and Flutter (the
      # pinned SDK, put on PATH, and one pub get). Each is skipped cleanly when the
      # workspace has no project in that language.
      - run: npx mnci ci setup
        name: Set up the language toolchains (Python, Go, Flutter)

      # Fails ONLY on an advisory that has a published fix, at moderate or above;
      # anything upstream has not fixed is printed and passes. pip-audit only
      # reports: its output has no "a fix exists" field to draw that line with.
      - run: npx mnci ci audit
        name: Audit dependencies (fails on an actionable npm advisory)

      # .NET, if the workspace has any. actions/setup-dotnet is the
      # maintained, cached installer GitHub itself ships, so this uses it
      # directly rather than a hand-rolled 'node -e' guard — see
      # DOTNET_DETECT_AZURE's remarks for the full reasoning. hashFiles()
      # gates it inline, so a JS-only workspace pays nothing.
      - uses: actions/setup-dotnet@${ACTION_VERSIONS['actions/setup-dotnet']}
        if: \${{ hashFiles('apps/*/*.csproj', 'packages/*/*.csproj', 'libs/*/*.csproj') != '' }}
        with:
          dotnet-version: ${DOTNET_SDK_VERSION}

      # Fails fast on a stale TypeScript project reference, then the one verify
      # step, and deliberately the only one: affected projects on a pull request,
      # EVERY project on anything else (a push to main included, so a release is
      # always verified in full). Every fallback takes the full path, because a run
      # that verifies too little still reports green. Apps that need a C toolchain
      # are left to the native job.
      - run: npx mnci ci verify
        name: Verify (sync check, then affected on a PR, every project on main)

${phaseStart('pack', ' '.repeat(6))}
      # Pack every app into dist/drop/<type>-<name>.zip via each app's 'package'
      # target; skipped cleanly when the workspace has no apps yet.
      - run: npx mnci ci pack
        name: Pack all apps (one zip per app -> dist/drop)
        if: \${{ ${onMain} }}

      - uses: actions/upload-artifact@${ACTION_VERSIONS['actions/upload-artifact']}
        if: \${{ ${onMain} }}
        with:
          name: drop
          path: dist/drop
          if-no-files-found: ignore
${phaseEnd('pack', ' '.repeat(6))}

${slotMarkers('before-release', ' '.repeat(6))}

${phaseStart('release', ' '.repeat(6))}
      # Signs in to Microsoft Entra ID as the Marketplace publishing identity (an
      # app registration with a federated credential for this repository's main
      # branch), so the release step publishes VS Code extensions with
      # 'vsce publish --azure-credential' and no token. Runs only when the
      # AZURE_CLIENT_ID and AZURE_TENANT_ID repository variables exist and the
      # workspace has an extension (every one ships a .vscodeignore). No Azure
      # subscription is needed. Setup: README, 'VS Code extensions'.
      - uses: azure/login@${ACTION_VERSIONS['azure/login']}
        name: Sign in to Microsoft Entra ID (VS Code Marketplace)
        if: \${{ ${onMain} && vars.AZURE_CLIENT_ID != '' && hashFiles('apps/*/.vscodeignore') != '' }}
        with:
          client-id: \${{ vars.AZURE_CLIENT_ID }}
          tenant-id: \${{ vars.AZURE_TENANT_ID }}
          allow-no-subscriptions: true

      # The release, in the order that keeps a failure safe: refuse a shallow
      # clone, prove the npm token and name the PyPI projects it would create (all
      # BEFORE anything is tagged), then version + tag + publish in one 'nx release'
      # for npm, Python, C# and VS Code, then attach a releasable Go app's zips and
      # push the tags. Which registry, and whether GitHub Releases are on, are read
      # from the 'mnci' block of nx.json, not baked into this file. The secrets are
      # mapped here, in the one place a command cannot reach.
      #
      # RELEASE_SPECIFIER (repository variable, Settings -> Secrets and
      # variables -> Actions -> Variables) overrides the bump nx would compute
      # from conventional commits for THIS run: 'major', 'minor', 'patch', or an
      # exact version ('1.2.3'). With more than one releasable package a bare
      # keyword is unreliable (nx versions interdependent packages in two passes,
      # and the second computes from a version cached before the first), so the
      # command fails the run rather than under-bumping silently: prefer an exact
      # version, and clear the variable once the override is no longer needed.
      - run: npx mnci ci release
        name: Release — version, tag${githubReleases ? ', publish and GitHub Release' : ' and publish'} (npm + Python + C# + VS Code)
        if: \${{ ${onMain} }}
        env:
          ${npmAuthName}: ${npmAuthValue}${pypiTokenEnvLine(registryKind, name => `\${{ secrets.${name} }}`, ' '.repeat(10))}
          RELEASE_SPECIFIER: \${{ vars.RELEASE_SPECIFIER }}
          # A VS Code extension publishes with Entra ID when the sign-in step
          # above ran (VSCE_AUTH=entra), else with the VSCE_PAT token;
          # tools/vscode-extension.cjs skips the Marketplace with neither.
          VSCE_AUTH: \${{ vars.AZURE_CLIENT_ID != '' && 'entra' || '' }}
          VSCE_PAT: \${{ secrets.VSCE_PAT }}${
            githubReleases
              ? `
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`
              : ''
          }
${phaseEnd('release', ' '.repeat(6))}

${slotMarkers('after-release', ' '.repeat(6))}
${nativeApps ? githubNativeJob(npmAuthName, npmAuthValue, nativeRunners) : ''}`
}

/** Where a `pip` project's manifest can live, relative to the workspace root. */
const PIP_PROJECT_GLOBS = ['apps', 'python-packages', 'libs'] as const
/** Where a `pub` project's manifest can live, relative to the workspace root. */
const PUB_PROJECT_GLOBS = ['apps', 'packages', 'libs'] as const
/** Manifest filenames that mark a directory as belonging to each ecosystem. */
const ECOSYSTEM_MANIFESTS = {
  pip: ['pyproject.toml', 'requirements.txt'],
  pub: ['pubspec.yaml'],
} as const

/**
 * Whether the workspace has at least one project of the given ecosystem.
 *
 * @remarks
 * Detection rather than assumption, and that distinction is the whole point of
 * {@link dependabotConfig} — see there.
 *
 * @param workspaceRoot - The workspace to scan.
 * @param roots - The directories whose immediate children are projects.
 * @param manifests - Filenames that mark a project of this ecosystem.
 * @returns `true` when any project directory holds one of the manifests.
 * @throws Never - a missing directory reads as empty.
 * @typeParam None - this function has no generic type parameters.
 */
function hasEcosystemProject (
  workspaceRoot: string,
  roots: readonly string[],
  manifests: readonly string[],
): boolean {
  return roots.some(root => {
    const base = join(workspaceRoot, root)
    if (!existsSync(base)) {
      return false
    }

    return readdirSync(base, { withFileTypes: true }).some(
      entry =>
        entry.isDirectory() &&
        manifests.some(manifest => existsSync(join(base, entry.name, manifest))),
    )
  })
}

/**
 * One `updates:` entry, covering a whole ecosystem by glob.
 *
 * @param ecosystem - The `package-ecosystem` value.
 * @param roots - Directories whose immediate children hold the manifests.
 * @returns The YAML block, with a leading blank line.
 * @throws Never - string building.
 * @typeParam None - this function has no generic type parameters.
 */
function dependabotBlock (ecosystem: string, roots: readonly string[]): string {
  return (
    `\n  - package-ecosystem: ${ecosystem}\n    directories:\n` +
    roots.map(root => `      - "/${root}/*"\n`).join('') +
    '    schedule:\n      interval: weekly\n'
  )
}

/**
 * The `.github/dependabot.yml` written for GitHub-hosted workspaces.
 *
 * @remarks
 * Cheap, high-signal hygiene every generated workspace gets automatically —
 * this very repo shipped without one and GitHub had to flag vulnerabilities
 * after the fact on every push instead of proposing update PRs proactively.
 * Dependabot is a GitHub-native feature (no app install, unlike Renovate), so
 * it is written only for `github`/`both` workspaces.
 *
 * `npm` and `github-actions` are unconditional, both at the workspace root:
 * `npm ci` installs every `packages/*` project from the one root lockfile, and
 * the actions entry patches the workflow {@link githubActionsYaml} writes.
 *
 * **`pip` and `pub` are emitted only when such a project actually exists, and
 * that is a bug fix rather than a refinement.** These blocks used to be written
 * unconditionally, on the stated reasoning that "a glob matching nothing yet is
 * not an error — Dependabot simply finds no manifest there yet". That claim was
 * false, and nothing ever re-checked it. Measured against this repo's own
 * Dependabot Updates history: the `pip` job failed on EVERY weekly run for over
 * a month, and `pub` on every run since it was added, while `npm_and_yarn` and
 * `github_actions` succeeded alongside them. An ecosystem entry whose globs
 * match no manifest is a hard failure, so every generated workspace without a
 * Python or Dart project produced two red Dependabot runs a week, for the whole
 * of its life, over projects it does not have.
 *
 * The globs are kept for the ecosystems that ARE emitted, so a second Python
 * project needs no rewrite. What changed is only whether the block appears at
 * all. `registerProjectCommands` re-runs this after every `mnci add`, so the
 * block appears the moment the first such project lands, and `mnci upgrade`
 * back-fills an existing workspace.
 *
 * @param workspaceRoot - The workspace to scan for Python and Dart projects.
 * @returns The YAML to write to `.github/dependabot.yml`.
 * @throws Never - a missing directory reads as empty.
 * @typeParam None - this function has no generic type parameters.
 */
export function dependabotConfig (workspaceRoot: string): string {
  let config = `# Generated by MoNecromanCI. Weekly dependency-update PRs so vulnerable or
# stale dependencies surface as a reviewable PR instead of only a push-time
# warning.
#
# pip and pub appear here only once the workspace HAS a Python or Dart project.
# An ecosystem entry whose directories match no manifest is a hard Dependabot
# failure, not a no-op, so emitting them unconditionally cost every workspace
# two red runs a week over projects it does not have.
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    # The Nx packages are pinned to one exact version and must move together: a PR for one alone fails resolution
    # (ERESOLVE between @nx/eslint and @nx/jest) or leaves a second copy of nx in the lockfile (#295).
    groups:
      nx:
        patterns:
          - "nx"
          - "@nx/*"

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
`
  if (hasEcosystemProject(workspaceRoot, PIP_PROJECT_GLOBS, ECOSYSTEM_MANIFESTS.pip)) {
    config += dependabotBlock('pip', PIP_PROJECT_GLOBS)
  }
  // Dart projects are pub workspace members, so each declares its own
  // dependencies even though they all resolve through one root pubspec.lock —
  // hence per-project directories rather than just "/".
  if (hasEcosystemProject(workspaceRoot, PUB_PROJECT_GLOBS, ECOSYSTEM_MANIFESTS.pub)) {
    config += dependabotBlock('pub', PUB_PROJECT_GLOBS)
  }

  return config
}

/**
 * Options for {@link applyOverlay}.
 *
 * @remarks
 * Collected by `mnci new`'s flags or prompts.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface OverlayOptions {
  /** The monorepo workspace name. */
  workspaceName: string
  /** The npm scope for publishable packages (e.g. `@demo`). */
  scope:         string
  /** Where publishable packages are released to. */
  registry:      RegistryConfig
  /** The CI build agent — a Microsoft-hosted vmImage or a self-hosted pool name. */
  agent:         string
  /** The Library variable group holding the base64 npm `PAT` (e.g. `Build`). */
  variableGroup: string
  /** Which CI provider(s) to write a pipeline file for. */
  ci:            CiProvider
  /** The stack (TS major, linter, test runner) chosen at `new`. */
  stack:         StackConfig
  /**
   * How npm authenticates against an Azure Artifacts feed. Absent means `pat`, so
   * a workspace generated before this existed keeps the file it has.
   */
  npmAuth?:      NpmAuthMode
}

/**
 * Files `create-nx-workspace` scaffolds that mnci deliberately replaces.
 *
 * @remarks
 * Each entry duplicates something mnci owns, and leaving it in place is not
 * merely untidy — in the `.prettierrc` case it silently WINS:
 *
 * - **`.prettierrc`** — Nx writes `{ "singleQuote": true }`. Prettier resolves
 *   `.prettierrc` before `.prettierrc.json`, so every option in
 *   mnci's own formatting opinion was being ignored in every generated workspace.
 *   Deleting it is what makes mnci's formatting opinion take effect at all.
 * - **`.vscode/`** — `extensions.json` lists the same recommendations the
 *   `<workspace>.code-workspace` file already carries, so VS Code shows the
 *   prompt twice and the two drift apart. mnci owned this file once
 *   (`.vscode/extensions.json`), then moved to the single-file workspace and
 *   never cleaned up the old location.
 * - **the AI-agent scaffolding** — `create-nx-workspace` 23.x writes ten
 *   entries of it, and three copies of its `monitor-ci` scripts fail
 *   `@mnci/eslint-config` with 36 errors (`unicorn/prefer-number-coercion`,
 *   `unicorn/prefer-simple-condition-first`). So `mnci new` ended with
 *   "eslint could not format '.' (exit code 1)" and `npm run lint` was RED on
 *   a pristine workspace. Measured on 23.2.1.
 *
 * On that last one, two things were tried first and are recorded so nobody
 * repeats them:
 *
 * 1. `--aiAgents=none`, which `create-nx-workspace --help` documents ("Use
 *    \"none\" to skip"). It does nothing on 23.2.1: a workspace generated with
 *    it holds byte-identical scaffolding to one generated without it, in both
 *    the `=none` and the space-separated array form. Verified against the real
 *    binary, three times.
 * 2. Ignoring the files in `mnci/ignores` instead. That leaves files in the
 *    repository the workspace's own linter disowns, which is exactly the
 *    fragmentation the single root config exists to end.
 *
 * The list has to be COMPLETE, and that is the subtle part. Nx prints "Your AI
 * agent configuration is outdated" after a task run when an agent has both an
 * MCP config and rules present but would change if regenerated. Delete some of
 * the set and that condition still holds, so every `nx` command nags forever;
 * delete all of it and nothing is detected at all. `.github/agents` and
 * `.github/prompts` are the two easiest to miss — verified by deleting the full
 * set from a real workspace and confirming `nx show projects` and
 * `nx run-many -t build` print nothing.
 *
 * A user who wants them back runs `nx configure-ai-agents`, which is the
 * supported way in and is what the nag itself recommends.
 *
 * Removal is idempotent and safe on a workspace where they are already gone,
 * which is what makes `mnci upgrade` able to repair an existing workspace.
 */
const NX_SCAFFOLDING_TO_REMOVE = [
  '.prettierrc',
  '.prettierrc.json',
  '.vscode',
  // See LOCAL_REGISTRY_SCAFFOLDING: the config half of a publishing mechanism
  // this workspace does not use.
  '.verdaccio',
  // The AI-agent set, in full. See the remarks above: a partial delete leaves
  // every `nx` command printing an "outdated configuration" nag.
  '.agents',
  '.codex',
  '.cursor',
  '.gemini',
  '.opencode',
  '.github/agents',
  '.github/prompts',
  '.github/skills',
  'opencode.json',
  // `.claude`, `AGENTS.md` and `CLAUDE.md` are NOT here. See
  // {@link NX_AUTHORED_AGENT_FILES} and {@link removeNxAuthoredAgentFiles}:
  // all three are paths a user writes by hand, so they are removed by what
  // they CONTAIN rather than by where they are.
] as const

/**
 * The marker Nx wraps its own agent rules in, and the file it owns outright.
 *
 * @remarks
 * `nx configure-ai-agents` writes its rules into `AGENTS.md` and `CLAUDE.md`
 * between a start and an end comment, and tells the reader to leave them
 * alone so the block can be updated in place. That marker is the only honest
 * way to tell Nx's text from the user's: both files are, by convention, where
 * a person writes instructions for their own repository. This project's own
 * `CLAUDE.md` is five hundred lines of hand-written guide with no marker in
 * it, and the previous behaviour - deleting both files by path - would have
 * taken all of it.
 *
 * `.claude/settings.json` is different: Nx writes the whole file, to register
 * its plugin marketplace, so it is removed outright. The rest of `.claude` -
 * `agents/`, `commands/`, anything else a user puts there - is theirs.
 */
const NX_AGENT_RULES_MARKER = '<!-- nx configuration start-->'

/** Where Nx's own agent rules live, alongside whatever the user wrote there. */
const NX_AUTHORED_AGENT_FILES = ['AGENTS.md', 'CLAUDE.md'] as const

/** The one file under `.claude` that Nx writes in full. */
const NX_CLAUDE_SETTINGS = '.claude/settings.json'

/**
 * One key removed from a record, without mutating the original.
 *
 * @remarks
 * Exists because the destructuring form of this needs a computed key, which
 * reads badly enough that the lint config rejects it.
 *
 * @param record - The record to copy.
 * @param key - The key to leave out.
 * @returns A new record without that key.
 * @throws Never - pure object construction.
 * @typeParam T - The record's value type.
 */
function withoutKey<T> (record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

/**
 * The local-registry story `@nx/js:lib --publishable` scaffolds, in the three
 * places it puts itself.
 *
 * @remarks
 * Generating a publishable library drops a `.verdaccio/config.yml`, a
 * `verdaccio` devDependency at the root, and a root `local-registry` target
 * wired to both. It is Nx's own way of rehearsing a publish against a
 * throwaway registry.
 *
 * mnci's way is different and already written down: `nx release` is tag-only
 * and publishes from CI on a push to `main`, and `npm run release:preview`
 * rehearses it without a registry at all. So this is a second publishing
 * mechanism arriving unasked, that nothing in the workspace refers to, and
 * bringing a devDependency with its own transitive tree and its own advisories
 * for a feature nobody chose.
 *
 * Deleted rather than documented, for the same reason as `.vscode/` and the
 * retired formatter configs: it re-appears on every `mnci add npm-lib`, so
 * leaving it is not a one-time cost. Anyone who wants a local registry can add
 * one deliberately; what they cannot do is notice it arriving.
 */
export const LOCAL_REGISTRY_SCAFFOLDING = {
  /** The config directory, removed with the rest of {@link NX_SCAFFOLDING_TO_REMOVE}. */
  directory:     '.verdaccio',
  /** The root devDependency the target runs. */
  devDependency: 'verdaccio',
  /** The root Nx target wired to both of the above. */
  rootTarget:    'local-registry',
} as const

/**
 * Deletes the local-registry scaffolding from a workspace that already has it.
 *
 * @remarks
 * `applyOverlay` handles `mnci new` and `mnci upgrade` on its own — it removes
 * the directory with the rest of the Nx scaffolding, and drops the
 * devDependency and the target while rewriting the root manifest. This is for
 * `mnci add`, which scaffolds a publishable library without going near the
 * overlay.
 *
 * Edits in place rather than rebuilding from a spread, so every untouched key
 * keeps its position: a rebuild moves `devDependencies` and `nx` to the end of
 * the file, which is a diff in every generated workspace for no reason.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Propagates any Node.js `fs` error other than a missing path.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeLocalRegistryScaffolding (workspaceRoot: string): void {
  rmSync(join(workspaceRoot, LOCAL_REGISTRY_SCAFFOLDING.directory), {
    recursive: true,
    force:     true,
  })

  const manifestPath = join(workspaceRoot, 'package.json')
  if (!fileExists(manifestPath)) return

  const manifest = readJson<{
    devDependencies?: Record<string, string>
    nx?:              Record<string, unknown> & { targets?: Record<string, unknown> }
  } & Record<string, unknown>>(manifestPath)

  if (manifest.devDependencies?.[LOCAL_REGISTRY_SCAFFOLDING.devDependency] !== undefined) {
    delete manifest.devDependencies[LOCAL_REGISTRY_SCAFFOLDING.devDependency]
    if (Object.keys(manifest.devDependencies).length === 0) delete manifest.devDependencies
  }
  if (manifest.nx?.targets?.[LOCAL_REGISTRY_SCAFFOLDING.rootTarget] !== undefined) {
    delete manifest.nx.targets[LOCAL_REGISTRY_SCAFFOLDING.rootTarget]
    // Emptied containers go entirely: nothing else in a generated manifest
    // carries an empty object, so a stray one would read as deliberate.
    if (Object.keys(manifest.nx.targets).length === 0) delete manifest.nx.targets
    if (Object.keys(manifest.nx).length === 0) delete manifest.nx
  }

  writeFileEnsured(manifestPath, toJson(manifest))
}

/**
 * Deletes the `create-nx-workspace` scaffolding mnci replaces.
 *
 * @remarks
 * See {@link NX_SCAFFOLDING_TO_REMOVE} for why each entry has to go. This is
 * the first thing `applyOverlay` deletes rather than overwrites, so
 * `mnci upgrade`'s "review with `git diff`" advice now covers deletions too.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Propagates any Node.js `fs` error other than a missing path.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeNxScaffolding (workspaceRoot: string): void {
  for (const entry of NX_SCAFFOLDING_TO_REMOVE) {
    rmSync(join(workspaceRoot, entry), { recursive: true, force: true })
  }
  removeNxAuthoredAgentFiles(workspaceRoot)
  removeProjectEslintConfigs(workspaceRoot)
}

/**
 * Strips Nx's agent rules from `AGENTS.md` and `CLAUDE.md`, keeping the rest.
 *
 * @remarks
 * The rules sit between {@link NX_AGENT_RULES_MARKER} and its closing
 * comment, which Nx puts there precisely so the block can be replaced without
 * touching what surrounds it. Everything outside the block is the user's and
 * survives; the file is deleted only when the block WAS the whole file, which
 * is the case `create-nx-workspace` produces.
 *
 * A file with no marker is Nx-unaware and is left completely alone - this
 * project's own `CLAUDE.md` is exactly that, and the previous by-path deletion
 * would have removed it in full.
 *
 * Suppressing Nx's "your AI agent configuration is outdated" nag needs the
 * rules gone, not the file gone: the nag fires on rules that would change if
 * regenerated, and an excised block leaves none. Verified against a real
 * workspace with `nx show projects` and `nx run-many -t build`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Propagates any Node.js `fs` error other than a missing path.
 * @typeParam None - this function has no generic type parameters.
 */
function removeNxAuthoredAgentFiles (workspaceRoot: string): void {
  // Nx writes this one in full, to register its plugin marketplace. The rest
  // of `.claude` - agents, commands - is the user's and is left alone.
  rmSync(join(workspaceRoot, NX_CLAUDE_SETTINGS), { force: true })
  // ...but when settings.json was all there was, the directory goes too. An
  // empty `.claude/` is still AI-agent scaffolding to every tool that probes
  // for the directory, and the e2e's "no AI-agent scaffolding: .claude" check
  // failed on every fresh workspace because of exactly this leftover.
  const claudeDirectory = join(workspaceRoot, dirname(NX_CLAUDE_SETTINGS))
  if (existsSync(claudeDirectory) && readdirSync(claudeDirectory).length === 0) {
    rmSync(claudeDirectory, { recursive: true, force: true })
  }

  for (const name of NX_AUTHORED_AGENT_FILES) {
    const path = join(workspaceRoot, name)
    if (!existsSync(path)) continue

    const kept = withoutNxAgentRules(readFileSync(path, 'utf8'))
    if (kept === undefined) continue

    if (kept.trim() === '') rmSync(path, { force: true })
    else writeFileEnsured(path, kept)
  }
}

/**
 * One agent-rules file with Nx's marked block taken out.
 *
 * @remarks
 * Returns `undefined` when there is no block to remove, so the caller can
 * leave a hand-written file untouched rather than rewriting it byte-for-byte
 * and showing a spurious diff.
 *
 * The end marker is matched by its opening rather than spelled out in full:
 * Nx has changed the words inside it before, and a missed match would silently
 * mean "no block", which is the failure that loses nothing but fixes nothing.
 *
 * @param content - The file's current text.
 * @returns What should remain, or `undefined` when the file carries no block.
 * @throws Never - pure string manipulation.
 * @typeParam None - this function has no generic type parameters.
 */
function withoutNxAgentRules (content: string): string | undefined {
  const start = content.indexOf(NX_AGENT_RULES_MARKER)
  if (start === -1) return undefined

  const endMarker = '<!-- nx configuration end'
  const end = content.indexOf(endMarker, start)
  if (end === -1) return undefined

  const afterEnd = content.indexOf('>', end)
  const rest = afterEnd === -1 ? '' : content.slice(afterEnd + 1)

  // `[\r\n]`, not `\n`: a repository checked out on Windows has CRLF line
  // endings, and trimming only the LF leaves the carriage returns behind as
  // blank lines at the top of the file - which is most of this project's own
  // users, since Windows is the platform its e2e runs on.
  return `${content.slice(0, start)}${rest}`.replace(/^[\r\n]+/, '')
}

/**
 * Deletes one path if it exists, quietly.
 *
 * @remarks
 * For the config files that belong to the linter mode the workspace did **not**
 * choose. Leaving them behind is not cosmetic: two formatter configs means the
 * editor and CI can disagree about which one applies, which is the same class of
 * silent failure as the `.prettierrc` precedence bug — a config that is present,
 * valid, and ignored.
 *
 * `force: true` makes a missing path a no-op, which is the common case: a fresh
 * `mnci new` has neither mode's files yet.
 *
 * @param path - Absolute path to remove.
 * @returns Nothing.
 * @throws Propagates any Node.js `fs` error other than a missing path.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeIfPresent (path: string): void {
  rmSync(path, { recursive: true, force: true })
}

/**
 * Adds `.eslintcache` to `.gitignore` if it is not already there.
 *
 * @remarks
 * `mnci` never writes `.gitignore` itself — `create-nx-workspace` owns that
 * file, and nothing here needed adding to it, historically. That stopped
 * being true the moment the root `format`/`lint` scripts adopted
 * `eslint --cache` (measured 3.4x faster on an unchanged re-run): the very
 * first `npm run format` a fresh workspace runs — during `mnci new` itself —
 * writes a root `.eslintcache` file that `create-nx-workspace`'s own
 * `.gitignore` template has no reason to know about. Confirmed end to end: a
 * freshly generated workspace's very first `git add -A` (the command
 * `mnci new`'s own "Next steps" output tells the user to run) stages it.
 *
 * A plain string check, not a `.gitignore` parser: `.eslintcache` is written
 * here as a single bare line, so a literal line match is exactly as correct
 * as parsing gitignore syntax would be, without pulling in a parser for one
 * pattern. Idempotent — `mnci upgrade` runs this on every existing workspace,
 * and a workspace that already has the line (added by hand, or by a previous
 * `mnci upgrade`) is left untouched.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Propagates any `fs` error reading or writing `.gitignore`.
 * @typeParam None - this function has no generic type parameters.
 */
export function ensureEslintCacheIgnored (workspaceRoot: string): void {
  const gitignorePath = join(workspaceRoot, '.gitignore')
  if (!fileExists(gitignorePath)) {
    return
  }
  const current = readFileSync(gitignorePath, 'utf8')
  if (current.split('\n').some(line => line.trim() === '.eslintcache')) {
    return
  }
  const withoutTrailingBlankLines = current.replace(/\n+$/, '')
  const separator = withoutTrailingBlankLines.length > 0 ? '\n\n' : ''
  writeFileEnsured(
    gitignorePath,
    `${withoutTrailingBlankLines}${separator}# Added by MoNecromanCI: \`npm run format\`/\`lint\` run \`eslint --cache\`.\n.eslintcache\n`,
  )
}

/**
 * Lines every Python project needs `.gitignore` to carry, and nothing more.
 *
 * @remarks
 * Deliberately just the bytecode. Running `lint`, `typecheck` and `test` on a
 * generated `python-lib` writes five directories - `__pycache__/` twice,
 * `.mypy_cache/`, `.pytest_cache/` and `.ruff_cache/` - and the last three each
 * write their own `.gitignore` containing `*`, so they need nothing from here.
 * CPython does not, which is why `__pycache__/` is the one that leaks.
 *
 * Measured on a real generated workspace rather than assumed: after
 * `nx run-many -t lint,typecheck,test`, `git status` named exactly the two
 * `__pycache__/` directories and nothing else.
 *
 * `.venv/` is NOT here. mnci invokes the Python toolchain as `python3 -m <tool>`
 * and never creates a virtualenv, so ignoring one would be a guess about how
 * someone works rather than a fact about what this generates.
 */
const PYTHON_ARTEFACT_IGNORES = ['__pycache__/', '*.py[cod]'] as const

/**
 * Adds the Python bytecode ignores when the workspace has a Python project.
 *
 * @remarks
 * `create-nx-workspace`'s `.gitignore` is a JavaScript template: `dist`, `tmp`,
 * `out-tsc`, `node_modules`, and not one line about any other language. That was
 * fine while mnci only scaffolded JavaScript, and has been wrong since it
 * scaffolded Python - the first `git add -A` after running a Python project's
 * own targets commits its bytecode.
 *
 * Found from the outside: a repository built with this CLI needed a hand-written
 * commit to add these lines, and `.gitignore` is the one file mnci appends to
 * without owning (see {@link ensureEslintCacheIgnored}, and `react-app`'s
 * `.env` negation) - so appending here is the established shape rather than a
 * new one.
 *
 * Conditional on a Python project existing, unlike `.eslintcache`, which every
 * workspace produces. A pure-JavaScript workspace has no business carrying
 * ignores for a language it does not use.
 *
 * Idempotent: `mnci upgrade` runs this on every existing workspace, and lines
 * already present - added by hand or by a previous upgrade - are left alone.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Propagates any `fs` error reading or writing `.gitignore`.
 * @typeParam None - this function has no generic type parameters.
 */
export function ensurePythonArtefactsIgnored (workspaceRoot: string): void {
  const gitignorePath = join(workspaceRoot, '.gitignore')
  if (!fileExists(gitignorePath)) {
    return
  }
  // The same three roots every other Python-aware guard here scans.
  const hasPython =
    globSync(
      ['python-packages/*/pyproject.toml', 'apps/*/pyproject.toml', 'libs/*/pyproject.toml'],
      { cwd: workspaceRoot },
    ).length > 0
  if (!hasPython) {
    return
  }

  const current = readFileSync(gitignorePath, 'utf8')
  const present = new Set(current.split('\n').map(line => line.trim()))
  const missing = PYTHON_ARTEFACT_IGNORES.filter(line => !present.has(line))
  if (missing.length === 0) {
    return
  }

  const withoutTrailingBlankLines = current.replace(/\n+$/u, '')
  const separator = withoutTrailingBlankLines.length > 0 ? '\n\n' : ''
  const heading = [
    '# Added by MoNecromanCI: Python bytecode. The tool caches (.mypy_cache,',
    '# .pytest_cache, .ruff_cache) write their own .gitignore; CPython does not.',
  ].join('\n')
  writeFileEnsured(
    gitignorePath,
    `${withoutTrailingBlankLines}${separator}${heading}\n${missing.join('\n')}\n`,
  )
}

/**
 * Deletes every per-project ESLint config in the workspace.
 *
 * @remarks
 * An mnci workspace has exactly ONE ESLint config, at the root. `mnci add`
 * already deletes the one its generator just wrote
 * (`removeGeneratedEslintConfig` in `add/shared.ts`), but that only helps
 * projects created from now on.
 *
 * This is the migration path for workspaces generated **before** mnci owned
 * linting, which is the case that matters: they carry a config in every
 * `apps/*`, `libs/*` and `packages/*` directory, and without this an
 * `mnci upgrade` would install the root config while leaving each project
 * still linting itself against its own stale rules — the exact fragmentation
 * the root config exists to end. Verified against a real workspace: an
 * upgrade fixed every root file and left `packages/sdk/eslint.config.mjs`
 * behind until this was added.
 *
 * Only the three conventional project directories are swept, never the whole
 * tree, so a config a user deliberately placed elsewhere is left alone. The
 * root config is never matched — these globs are all one level deep inside a
 * project directory.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Propagates any Node.js `fs` error other than a missing path.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeProjectEslintConfigs (workspaceRoot: string): void {
  const matches = globSync('{apps,libs,packages}/*/eslint.config.{js,mjs,cjs,ts,mts,cts}', {
    cwd: workspaceRoot,
  })
  for (const match of matches) {
    rmSync(join(workspaceRoot, match), { force: true })
  }
}

/**
 * Applies MoNecromanCI's opinions on top of a freshly generated workspace.
 *
 * @remarks
 * This is the ONLY file-writing this CLI does — everything else in the
 * workspace is the untouched output of Nx's own generators. Writes: the
 * `nx.json` release patch, `eslint.config.mjs`, `.npmrc`,
 * `commitlint.config.mjs`, the husky
 * `commit-msg` hook, the `<workspace>.code-workspace` file and
 * the chosen CI provider's pipeline file(s) — `azure-pipelines.yml` and/or
 * `.github/workflows/ci.yml`, per `options.ci`. It also DELETES the Nx
 * scaffolding it replaces ({@link removeNxScaffolding}). Dependency
 * installation (`husky`, `@commitlint/*`) is the caller's job — it shells out
 * to real `npm install` so versions resolve at generation time instead of
 * being pinned here.
 *
 * @param workspaceRoot - Absolute path to the generated workspace.
 * @param options - The scope, registry, CI agent/variable group and provider chosen.
 * @returns Nothing.
 * @throws Propagates any Node.js `fs` error raised while reading or writing.
 * @typeParam None - this function has no generic type parameters.
 */
export function applyOverlay (
  workspaceRoot: string,
  options: OverlayOptions,
  onProgress: (message: string) => void = () => {},
): void {
  // Patch nx.json with the release opinion, the stack generator defaults, the
  // shared global inputs (so `nx affected` on a PR is not blind to the root
  // config files — see SHARED_GLOBAL_INPUTS) and sync.applyChanges (so a stale
  // TS project reference — e.g. from hand-adding a cross-project import — is
  // fixed automatically on the next build/typecheck, not just flagged with a
  // prompt). Both `nx release` and every later `nx g`/`mnci add` see the
  // generator defaults.
  const nxJsonPath = join(workspaceRoot, 'nx.json')
  const nxJson = readJson<Record<string, unknown>>(nxJsonPath)
  const generators = {
    ...(nxJson.generators as Record<string, unknown> | undefined),
    ...generatorDefaults(options.stack),
  }
  const sync = { ...(nxJson.sync as Record<string, unknown> | undefined), ...SYNC_CONFIG }
  const mnci = { ...(nxJson.mnci as Record<string, unknown> | undefined), ...mnciConfig(options) }
  /*
   * Read from the root manifest rather than assumed: the Python plugin arrives
   * only when `mnci add python-*` installs it, and registering a plugin Nx
   * cannot resolve is a hard failure of the whole project graph.
   */
  const rootManifest = readJson<{
    dependencies?:    Record<string, string>
    devDependencies?: Record<string, string>
  }>(join(workspaceRoot, 'package.json'))
  const hasPythonPlugin =
    (rootManifest.devDependencies ?? {})['@mnci/nx-python-pip'] !== undefined ||
    (rootManifest.dependencies ?? {})['@mnci/nx-python-pip'] !== undefined
  const withRelease = withReleaseConfig(nxJson, options.ci)
  const patched = withPythonGraphPlugin(
    withSharedGlobals(withEslintPlugin(withRelease)),
    hasPythonPlugin,
  )
  onProgress('nx.json — release, sync, generators, shared inputs, mnci block')
  writeFileEnsured(nxJsonPath, toJson({ ...patched, generators, sync, mnci }))

  // The preset names the root package a placeholder ('@org/source'); stamp the
  // chosen scope so `add npm-lib` can derive the default import path from it,
  // the curated everyday scripts (each a single cross-platform command, with
  // `lint` bound to the chosen linter), and the dual TS compiler — the alias
  // for `typescript` replaces the plain TS 6 the preset installed, and
  // `@typescript/native` adds the TS 7 `tsc`. The caller's `npm install`
  // materialises them.
  onProgress('package.json — root scripts, TS compilers, ESLint toolchain, overrides')
  const manifestPath = join(workspaceRoot, 'package.json')
  const manifest = readJson<Record<string, unknown>>(manifestPath)
  const scripts = {
    ...(manifest.scripts as Record<string, string> | undefined),
    ...rootScripts(),
  }
  const existingDevDeps = manifest.devDependencies as Record<string, string> | undefined
  // Dropped here as well as in `removeLocalRegistryScaffolding`, because this
  // merge is what carries an existing workspace's devDependencies across an
  // upgrade - so without this `mnci upgrade` would delete `.verdaccio/` and
  // leave the dependency that populates it.
  const devDeps = withoutKey(
    withoutRetiredFormatterDependencies({
      ...existingDevDeps,
      ...TS_COMPILER_DEPENDENCIES,
      // The preset pins `nx` itself; the ESLint plugins must match it exactly.
      ...mnciToolchainDependencies(existingDevDeps?.nx ?? 'latest'),
    }),
    LOCAL_REGISTRY_SCAFFOLDING.devDependency,
  )
  // Merged, never replaced: a workspace's own overrides must survive an upgrade.
  const overrides = {
    ...(manifest.overrides as Record<string, unknown> | undefined),
    ...ESLINT_PEER_OVERRIDES,
    ...SECURITY_OVERRIDES,
    // Static, so it is present before any generator can run an install — see
    // NX_PEER_OVERRIDES for why the conditional form could never be.
    ...NX_PEER_OVERRIDES,
  }
  // The root project's own Nx config. Merged the same way, so a workspace that
  // added root targets of its own keeps them — see ROOT_LINT_TARGET for why
  // `includedScripts` must stay empty.
  const existingNx = manifest.nx as Record<string, unknown> | undefined
  // Same reason as the devDependency above: the merge is what would otherwise
  // carry the target across an upgrade, pointing at a config file this run has
  // just deleted.
  const existingTargets = withoutKey(
    (existingNx?.targets as Record<string, unknown> | undefined) ?? {},
    LOCAL_REGISTRY_SCAFFOLDING.rootTarget,
  )
  const nx = {
    ...existingNx,
    includedScripts: (existingNx?.includedScripts as unknown[] | undefined) ?? [],
    targets:         {
      ...existingTargets,
      lint: ROOT_LINT_TARGET,
    },
  }
  writeFileEnsured(
    manifestPath,
    toJson({
      ...manifest,
      name:            `${options.scope}/source`,
      scripts,
      devDependencies: devDeps,
      overrides,
      nx,
    }),
  )

  onProgress(
    `.npmrc — ${
      options.registry.kind === 'azure-artifacts'
        ? 'Azure Artifacts feed routing and credentials'
        : 'public npm registry auth'
    }`,
  )
  writeFileEnsured(
    join(workspaceRoot, '.npmrc'),
    npmrcContent(options.registry, options.scope, options.npmAuth),
  )
  onProgress('commitlint.config.mjs and .husky/commit-msg — conventional commit enforcement')
  writeFileEnsured(join(workspaceRoot, 'commitlint.config.mjs'), COMMITLINT_CONFIG)
  const hookPath = join(workspaceRoot, '.husky/commit-msg')
  writeFileEnsured(hookPath, COMMIT_MSG_HOOK)
  markExecutable(hookPath)
  // ESLint handles code quality, type-aware correctness AND formatting
  // (JavaScript Standard Style) — one tool, at the root. `add` deletes the
  // per-project configs Nx generators write.
  //
  // TWO files, and only the first is ours. `eslint.config.mnci.mjs` carries
  // every rule and is rewritten here on every upgrade; `eslint.config.mjs` is
  // what ESLint actually loads, imports that one, and holds the workspace's
  // own blocks — so it is written once and then left alone forever. Rewriting
  // it is what used to delete a user's overrides on upgrade, silently, having
  // told them in a comment that appending was how overriding worked.
  onProgress(`${ESLINT_MNCI_FILENAME} — the shared lint AND formatting opinion`)
  writeFileEnsured(join(workspaceRoot, ESLINT_MNCI_FILENAME), ESLINT_MNCI_CONFIG)
  writeEslintEntryPoint(workspaceRoot, onProgress)
  // `format`/`lint`'s `--cache` flag writes a root .eslintcache that
  // create-nx-workspace's own .gitignore template has no reason to know
  // about — see ensureEslintCacheIgnored.
  ensureEslintCacheIgnored(workspaceRoot)
  // Same file, same reason, different language: create-nx-workspace's template
  // says nothing about Python because it is a JavaScript template.
  ensurePythonArtefactsIgnored(workspaceRoot)
  // Every config a previous mnci version could have written for a second tool
  // has to be REMOVED, not merely left unwritten. A stale `.prettierrc.mjs` or
  // `.oxfmtrc.json` does nothing on its own now that neither binary runs, but a
  // globally installed `esbenp.prettier-vscode` or `oxc.oxc-vscode` resolves it
  // and reformats on save against an opinion no gate checks — silently undoing
  // Standard in the editor while CI stays green. `mnci upgrade` runs this same
  // path, so migrating an existing workspace is one command.
  for (const retired of RETIRED_FORMATTER_FILES) {
    removeIfPresent(join(workspaceRoot, retired))
  }
  // Makes a local environment match the one CI verifies — see devcontainerJson.
  onProgress('.devcontainer/devcontainer.json — a local toolchain matching CI')
  writeFileEnsured(
    join(workspaceRoot, '.devcontainer/devcontainer.json'),
    devcontainerJson(options.workspaceName),
  )
  removeNxScaffolding(workspaceRoot)
  // VS Code workspace file with folder structure, extensions, and settings. The
  // `tasks` array is read back first and carried through: it is per-project state
  // written by `mnci add`, not overlay-owned, so regenerating it wholesale would
  // wipe every registered build/qa/start task on `mnci upgrade`.
  onProgress(
    `${options.workspaceName}.code-workspace — settings, extensions, launch configs`,
  )
  const codeWorkspacePath = join(workspaceRoot, `${options.workspaceName}.code-workspace`)
  const existing = readCodeWorkspace<{
    tasks?:    { version?: string; tasks?: Record<string, unknown>[] }
    launch?:   { version?: string; configurations?: Record<string, unknown>[] }
    settings?: Record<string, unknown>
  }>(codeWorkspacePath)
  writeFileEnsured(
    codeWorkspacePath,
    vscodeWorkspace(
      options.workspaceName,
      existing?.tasks,
      existing?.launch,
      existing?.settings,
    ),
  )
  // Repairs mnci's own past bug rather than tidying: `mnci upgrade` used to pass
  // no `workspaceName` at all, so this write landed on the literal filename
  // `undefined.code-workspace` and the workspace's real one was never refreshed.
  // Any workspace upgraded before that fix still carries the junk file, and only
  // an upgrade can clear it. Guarded on the name so a workspace genuinely called
  // `undefined` does not delete its own file.
  if (options.workspaceName !== 'undefined') {
    rmSync(join(workspaceRoot, 'undefined.code-workspace'), { force: true })
  }
  // Either or both, per the chosen provider — a GitHub-hosted repo can skip
  // the unused Azure file entirely instead of carrying dead CI config.
  const publishUrl = pythonPublishUrl(options.registry)
  const nugetUrl = nugetFeedUrl(options.registry)
  // Decided here, when the file is written: neither provider can skip a whole job
  // on a file's existence, and a workspace with no native app keeps its pipeline as is.
  const nativeApps = hasNativeGoApp(workspaceRoot)
  const nativeRunners = readNativeBuildConfig(workspaceRoot).config.runners
  if (options.ci === 'azure' || options.ci === 'both') {
    onProgress('azure-pipelines.yml — build, verify, pack and release')
    writePipeline(
      join(workspaceRoot, 'azure-pipelines.yml'),
      onProgress,
      azurePipelinesYaml(
        options.agent,
        options.variableGroup,
        publishUrl,
        options.registry.kind,
        nugetUrl,
        options.npmAuth,
        nativeApps,
        nativeRunners,
      ),
    )
  }
  if (options.ci === 'github' || options.ci === 'both') {
    onProgress('.github/workflows/ci.yml and dependabot.yml')
    writePipeline(
      join(workspaceRoot, '.github/workflows/ci.yml'),
      onProgress,
      githubActionsYaml(options.agent, publishUrl, options.registry.kind, options.ci, nugetUrl, nativeApps, nativeRunners),
    )
    writeFileEnsured(join(workspaceRoot, '.github/dependabot.yml'), dependabotConfig(workspaceRoot))
  }
}
