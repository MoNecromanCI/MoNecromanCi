import yaml from 'js-yaml'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ACTION_VERSIONS,
  applyOverlay,
  azurePipelinesYaml,
  DEFAULT_STACK,
  devcontainerJson,
  ensureEslintCacheIgnored,
  ensurePythonArtefactsIgnored,
  ESLINT_BLOCK_INVENTORY,
  DOTNET_SDK_VERSION,
  GO_VERSION,
  GOLANGCI_LINT_VERSION,
  CLI_VERSION,
  ESLINT_CONFIG_VERSION,
  ESLINT_PEER_OVERRIDES,
  ESLINT_VERSION,
  ESLINT_USER_CONFIG,
  FORMATTED_LANGUAGES,
  generatorDefaults,
  githubActionsYaml,
  hasNativeGoApp,
  isUnmodifiedMnciEslintConfig,
  mergeOverrides,
  mnciConfig,
  NODE_VERSION,
  NPM_VERSION,
  npmrcContent,
  NUGET_AZURE_SOURCE,
  nugetConfigContent,
  nugetFeedUrl,
  poolBlock,
  pythonPublishUrl,
  resolveNpmAuth,
  readMnciConfig,
  registryUrl,
  RETIRED_FORMATTER_FILES,
  NX_PEER_OVERRIDES,
  ROOT_LINT_TARGET,
  rootScripts,
  SHARED_GLOBAL_INPUTS,
  type StackConfig,
  VSCODE_EXTENSION_TAG,
  VSCODE_RECOMMENDED_EXTENSIONS,
  LAUNCH_CONFIGURATIONS,
  vscodeSettings,
  vscodeWorkspace,
  withEslintPlugin,
  withReleaseConfig,
  withSharedGlobals,
  removeLocalRegistryScaffolding,
} from './overlay.use-case'

// POSIX-only assertions. See the note at each use for why the property cannot
// hold on Windows — in every case the product is correct and the platform
// simply cannot represent what is being asserted.
const itOnPosix = process.platform === 'win32' ? it.skip : it

describe('registryUrl', () => {
  it('builds the Azure Artifacts feed URL', () => {
    expect(
      registryUrl({
        kind:          'azure-artifacts',
        organization:  'org',
        project:       'proj',
        artifactsFeed: 'feed',
      }),
    ).toBe('https://pkgs.dev.azure.com/org/proj/_packaging/feed/npm/registry/')
  })

  it('returns undefined for public npm', () => {
    expect(registryUrl({ kind: 'npm' })).toBeUndefined()
  })
})

describe('pythonPublishUrl', () => {
  it('derives the pypi upload URL from the same Azure Artifacts feed (multi-protocol)', () => {
    expect(
      pythonPublishUrl({
        kind:          'azure-artifacts',
        organization:  'org',
        project:       'proj',
        artifactsFeed: 'feed',
      }),
    ).toBe('https://pkgs.dev.azure.com/org/proj/_packaging/feed/pypi/upload/')
  })

  it('returns undefined for public npm (no PyPI publish wired in this cut)', () => {
    expect(pythonPublishUrl({ kind: 'npm' })).toBeUndefined()
  })
})

/** Everything in an .npmrc that is not a comment or blank — i.e. actual config. */
function directives (npmrc: string): string[] {
  return npmrc
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith(';') && !line.startsWith('#'))
}

describe('resolveNpmAuth', () => {
  const azure = {
    kind:          'azure-artifacts',
    organization:  'org',
    project:       'proj',
    artifactsFeed: 'feed',
  } as const

  it('leaves a workspace on the default when nothing asks for anything else', () => {
    expect(resolveNpmAuth(undefined, azure, 'azure')).toBeUndefined()
    expect(resolveNpmAuth('pat', azure, 'both')).toBe('pat')
  })

  it('accepts build-identity for an Azure feed on an Azure pipeline', () => {
    expect(resolveNpmAuth('build-identity', azure, 'azure')).toBe('build-identity')
  })

  it('falls back to the persisted or detected mode when no flag is passed', () => {
    expect(resolveNpmAuth(undefined, azure, 'azure', 'build-identity')).toBe('build-identity')
    // An explicit flag beats the fallback in both directions.
    expect(resolveNpmAuth('pat', azure, 'azure', 'build-identity')).toBe('pat')
  })

  it('rejects a mode it does not know, naming the ones it does', () => {
    expect(() => resolveNpmAuth('token', azure, 'azure')).toThrow(/pat, build-identity/)
  })

  it.each(['github', 'both'] as const)(
    'refuses build-identity on --ci %s, because npmAuthenticate@0 is Azure-only',
    ci => {
      // Refused rather than generated: the credential-free .npmrc would
      // authenticate nowhere on the GitHub side, and the resulting publish failure
      // is a bare auth error that names neither the mode nor the flag.
      expect(() => resolveNpmAuth('build-identity', azure, ci)).toThrow(/Azure Pipelines task/)
    },
  )

  it('refuses build-identity for public npm, which has no identity to borrow', () => {
    expect(() => resolveNpmAuth('build-identity', { kind: 'npm' }, 'azure')).toThrow(
      /Azure Artifacts/,
    )
  })

  it('refuses a persisted build-identity that the current CI can no longer deliver', () => {
    // A workspace that adds a GitHub pipeline later must not silently keep a mode
    // one of its two pipelines cannot use.
    expect(() => resolveNpmAuth(undefined, azure, 'both', 'build-identity')).toThrow(
      /Azure Pipelines task/,
    )
  })
})

describe('npmrcContent', () => {
  const azure = {
    kind:          'azure-artifacts',
    organization:  'org',
    project:       'proj',
    artifactsFeed: 'feed',
  } as const

  it('authenticates the public npm registry, and routes nothing', () => {
    const npmrc = npmrcContent({ kind: 'npm' }, '@demo')

    expect(directives(npmrc)).toEqual(['//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}'])
  })

  it('deliberately omits scope routing for public npm, and says why', () => {
    // The historical bug this guards: the README claimed scope routing made an
    // accidental public publish impossible while no routing line was ever
    // emitted. Routing @demo to npmjs.org would ALSO not provide that, because
    // npmjs.org is the intended target — so the honest answer is no line plus an
    // explanation, not a line that looks protective.
    const npmrc = npmrcContent({ kind: 'npm' }, '@demo')

    expect(npmrc).not.toContain('@demo:registry=')
    expect(npmrc).toContain('deliberately NO')
  })

  it('routes the scope to the Azure feed — the one case where that IS protection', () => {
    const npmrc = npmrcContent(azure, '@demo')
    const feed = 'https://pkgs.dev.azure.com/org/proj/_packaging/feed/npm/registry/'

    // npm prefers a scope's registry over the global one when publishing a scoped
    // package, so this genuinely stops @demo/* reaching npmjs.org. Verified
    // against a real registry: npm reports "Publishing to <feed>".
    expect(directives(npmrc)).toContain(`@demo:registry=${feed}`)
  })

  it('routes ONLY the scope, so installing public packages needs no feed auth', () => {
    // A global `registry=` would send every install through the feed, making
    // `npm ci` require feed credentials just to fetch public dependencies.
    const npmrc = npmrcContent(azure, '@demo')

    expect(directives(npmrc).some(line => line.startsWith('registry='))).toBe(false)
  })

  it('supplies feed credentials keyed by the protocol-stripped feed URL', () => {
    const npmrc = npmrcContent(azure, '@demo')
    const key = '//pkgs.dev.azure.com/org/proj/_packaging/feed/npm/registry/'

    expect(directives(npmrc)).toContain(`${key}:_password=\${PAT}`)
    expect(directives(npmrc)).toContain(`${key}:username=AzureArtifacts`)
    // npm refuses to authenticate without an email field, and never uses it.
    expect(npmrc).toContain(`${key}:email=`)
  })

  it('uses the base64 PAT as-is for npm, unlike twine which needs it decoded', () => {
    // The trap: the same PAT is consumed in two encodings. npm's _password wants
    // the pre-encoded value Azure hands out; twine wants the raw token, which the
    // CI release step decodes. Getting these backwards fails at publish time only.
    const npmrc = npmrcContent(azure, '@demo')

    expect(npmrc).toContain('_password=${PAT}')
    expect(npmrc).not.toContain('Buffer.from')
  })

  it('keys BOTH path forms, because npm walks only up a URL when matching', () => {
    // npm resolves credentials by URL prefix and strips one segment at a time, so
    // an entry on '/npm/registry/' is never found for a request to '/npm/'.
    const npmrc = npmrcContent(azure, '@demo')
    const short = '//pkgs.dev.azure.com/org/proj/_packaging/feed/npm/'

    expect(directives(npmrc)).toContain(`${short}:_password=\${PAT}`)
    expect(directives(npmrc)).toContain(`${short}:username=AzureArtifacts`)
  })

  it('uses Basic auth, never _authToken, because Bearer here wants an Entra token', () => {
    // Measured against the real feed. An unauthenticated PUT to the publish
    // endpoint answers with:
    //   www-authenticate: Bearer authorization_uri=https://login.windows.net/<tenant>,
    //                     Basic realm="...", TFS-Federated
    // so Bearer wants an Entra ID access token, not a PAT. npm sends _authToken
    // verbatim as a Bearer header, and Azure rejects a PAT there with "Unable to
    // authenticate, your authentication token seems to be invalid". A PAT goes
    // through Basic, which is username/_password. This was shipped the wrong way
    // round once; the Packaging REST API accepts a PAT as Bearer, which is what
    // made the wrong generalisation look verified.
    const npmrc = npmrcContent(azure, '@demo')

    // Asserted on directives, not raw text: the comment above them names
    // _authToken precisely so nobody reintroduces it.
    expect(directives(npmrc).some((line) => line.includes('_authToken'))).toBe(false)
    expect(directives(npmrc).some((line) => line.includes('_password'))).toBe(true)
  })

  it('writes routing and NO credentials for build-identity auth', () => {
    const npmrc = npmrcContent(azure, '@demo', 'build-identity')

    // Exactly one directive: the scope route. Anything else here would be a
    // credential the pipeline task is supposed to be the only source of.
    expect(directives(npmrc)).toEqual([
      '@demo:registry=https://pkgs.dev.azure.com/org/proj/_packaging/feed/npm/registry/',
    ])
  })

  it('explains, in the file, why there is no credential and what that costs locally', () => {
    // The reasoning has to live where the person deleting or "fixing" the file will
    // read it. Two facts matter: a PAT cannot be sent as Bearer, and a developer
    // machine no longer inherits a credential from this file.
    const npmrc = npmrcContent(azure, '@demo', 'build-identity')

    expect(npmrc).toContain('npmAuthenticate@0')
    expect(npmrc).toContain('ENTRA ID')
    expect(npmrc).toContain('vsts-npm-auth')
  })

  it('keeps the PAT block as the default, unchanged by the new option', () => {
    expect(npmrcContent(azure, '@demo', 'pat')).toBe(npmrcContent(azure, '@demo'))
  })

  it('ignores the mode for public npm, where there is nothing to inject', () => {
    expect(npmrcContent({ kind: 'npm' }, '@demo', 'build-identity')).toBe(
      npmrcContent({ kind: 'npm' }, '@demo'),
    )
  })

  it('drops legacy-peer-deps, added for a plugin removed long ago', () => {
    // @nxazure/func is gone; the flag stayed behind and quietly weakened
    // dependency resolution in every generated workspace.
    expect(npmrcContent({ kind: 'npm' }, '@demo')).not.toContain('legacy-peer-deps')
    expect(npmrcContent(azure, '@demo')).not.toContain('legacy-peer-deps')
  })
})

describe('nugetFeedUrl', () => {
  it('derives the NuGet v3 feed URL from the same Azure Artifacts feed (multi-protocol)', () => {
    expect(
      nugetFeedUrl({
        kind:          'azure-artifacts',
        organization:  'org',
        project:       'proj',
        artifactsFeed: 'feed',
      }),
    ).toBe('https://pkgs.dev.azure.com/org/proj/_packaging/feed/nuget/v3/index.json')
  })

  it('returns undefined for public npm (no public-nuget.org publish wired in this cut)', () => {
    expect(nugetFeedUrl({ kind: 'npm' })).toBeUndefined()
  })
})

describe('nugetConfigContent', () => {
  const azureRegistry = {
    kind:          'azure-artifacts',
    organization:  'org',
    project:       'proj',
    artifactsFeed: 'feed',
  } as const

  it('registers only nuget.org, with no credentials, for the public npm registry', () => {
    const config = nugetConfigContent({ kind: 'npm' }, '@demo')

    expect(config).toContain('<add key="nuget.org" value="https://api.nuget.org/v3/index.json" />')
    expect(config).not.toContain('packageSourceCredentials')
    expect(config).not.toContain('ClearTextPassword')
  })

  it("explains why public-registry publish is unconfigured, matching PyPI's own gap", () => {
    const config = nugetConfigContent({ kind: 'npm' }, '@demo')

    expect(config).toContain('UNCONFIGURED')
    expect(config).toContain('azure-artifacts')
  })

  it('registers the Azure feed under the fixed NUGET_AZURE_SOURCE key, not the real feed name', () => {
    // The publish target in add/csharp.ts references this same constant, so
    // credentials and the push command can never drift from each other.
    const config = nugetConfigContent(azureRegistry, '@demo')
    const feedUrl = 'https://pkgs.dev.azure.com/org/proj/_packaging/feed/nuget/v3/index.json'

    expect(config).toContain(`<add key="${NUGET_AZURE_SOURCE}" value="${feedUrl}" />`)
    expect(config).not.toContain('key="feed"')
  })

  it('attaches credentials to that same registered source, as the RAW PAT via %NUGET_PAT%', () => {
    const config = nugetConfigContent(azureRegistry, '@demo')

    expect(config).toContain(`<${NUGET_AZURE_SOURCE}>`)
    expect(config).toContain('<add key="Username" value="AzureArtifacts" />')
    expect(config).toContain('<add key="ClearTextPassword" value="%NUGET_PAT%" />')
    // NuGet's substitution syntax is %VAR%, never ${VAR} or $VAR — confirmed
    // against Microsoft's own compatibility table.
    expect(config).not.toContain('${NUGET_PAT}')
    expect(config).not.toContain('$NUGET_PAT')
  })

  it("scopes the private feed to this workspace's own PascalScope.* packages", () => {
    // The NuGet analogue of .npmrc's scope-only routing: an unscoped source
    // would have every local `dotnet restore` query the private feed too.
    const config = nugetConfigContent(azureRegistry, '@my-org')

    expect(config).toContain(`<packageSource key="${NUGET_AZURE_SOURCE}">`)
    expect(config).toContain('<package pattern="MyOrg.*" />')
    expect(config).toContain('<packageSource key="nuget.org">')
    expect(config).toContain('<package pattern="*" />')
  })

  it('is well-formed XML with a single root <configuration> element', () => {
    for (const config of [nugetConfigContent({ kind: 'npm' }, '@demo'), nugetConfigContent(azureRegistry, '@demo')]) {
      expect(config).toMatch(/^<\?xml version="1\.0" encoding="utf-8"\?>/)
      expect(config.match(/<configuration>/g)).toHaveLength(1)
      expect(config.match(/<\/configuration>/g)).toHaveLength(1)
    }
  })

  // This is the rule the tag-balance check above CANNOT catch, and the one
  // that actually broke a real nightly: the npm-registry comment once
  // explained the escape hatch as "regenerate with --registry azure-artifacts",
  // and the XML spec forbids '--' anywhere inside a comment body. Nothing in
  // this file's own generation errored — the break surfaced three layers
  // downstream, as `dotnet restore` refusing to parse the generated
  // NuGet.Config at all ("NuGet.Config is not valid XML... An XML comment
  // cannot contain '--'"), which then took @nx/dotnet's own SDK-resolution
  // step down with it (a *different*, misleading error: "The SDK
  // 'Azure.Functions.Sdk/1.0.0' specified could not be found") and from there
  // the whole Nx project graph, breaking every later, unrelated `mnci add` in
  // the same e2e run. A test that only balances open/close tags passed the
  // whole time.
  it('never emits an XML comment containing "--" or ending in "-" — both invalidate the whole document', () => {
    for (const config of [nugetConfigContent({ kind: 'npm' }, '@demo'), nugetConfigContent(azureRegistry, '@demo')]) {
      const comments = config.match(/<!--[\s\S]*?-->/g) ?? []
      expect(comments.length).toBeGreaterThan(0)
      for (const comment of comments) {
        const body = comment.slice(4, -3)

        expect(body).not.toContain('--')
        expect(body.endsWith('-')).toBe(false)
      }
    }
  })
})

describe('withReleaseConfig, over a workspace that extended the release block', () => {
  // `release` is the one block a workspace legitimately has to extend: nx
  // exposes settings there that mnci has no opinion about and cannot enumerate
  // in advance. It used to be replaced wholesale, so `mnci upgrade` deleted
  // them — silently, and visibly only on the release path, which runs on the
  // default branch alone.
  const extended = {
    release: {
      version: {
        conventionalCommits:              true,
        // The real casualty. Without it nx REFUSES to release when an internal
        // dependency range cannot absorb the bump — which under a tag-only
        // model is always, since `git.commit` is false and the on-disk
        // manifests stay at the scaffold version forever.
        preserveMatchingDependencyRanges: false,
      },
      changelog:           { automaticFromRef: true },
      // A top-level key mnci has never emitted.
      conventionalCommits: { types: { chore: { changelog: false } } },
    },
  }

  it('keeps a nested release setting mnci does not emit', () => {
    const release = withReleaseConfig(extended, 'github').release as {
      version: Record<string, unknown>
    }

    expect(release.version.preserveMatchingDependencyRanges).toBe(false)
  })

  it('keeps additions in every release sub-block, not just the first', () => {
    const release = withReleaseConfig(extended, 'github').release as Record<
      string,
      Record<string, unknown>
    >

    expect(release.changelog.automaticFromRef).toBe(true)
    expect(release.conventionalCommits).toEqual({ types: { chore: { changelog: false } } })
  })

  it('still wins for every key it does emit', () => {
    // The merge has to go this way round. These encode the tag-only release
    // model, and a workspace silently flipping `git.commit` to true would be a
    // worse bug than the one being fixed here.
    const release = withReleaseConfig(
      { release: { git: { commit: true, tag: false }, projectsRelationship: 'fixed' } },
      'github',
    ) as { release: Record<string, Record<string, unknown> | string> }

    expect(release.release.projectsRelationship).toBe('independent')
    expect(release.release.git).toMatchObject({ commit: false, tag: true })
  })

  it('replaces an owned array rather than merging it element-wise', () => {
    // Otherwise a workspace could never drop an entry mnci once emitted.
    const release = withReleaseConfig(
      { release: { projects: ['legacy/*', 'packages/*', 'python-packages/*'] } },
      'github',
    ).release as { projects: string[] }

    expect(release.projects).not.toContain('legacy/*')
  })

  it('handles a workspace with no release block, and one whose release is not an object', () => {
    expect(withReleaseConfig({}, 'github').release).toMatchObject({
      projectsRelationship: 'independent',
    })
    expect(withReleaseConfig({ release: 'nonsense' }, 'github').release).toMatchObject({
      projectsRelationship: 'independent',
    })
  })
})

describe('withReleaseConfig', () => {
  it('patches release and defaultBase while preserving what the preset generated, for azure', () => {
    const patched = withReleaseConfig(
      {
        $schema:     './node_modules/nx/schemas/nx-schema.json',
        namedInputs: { default: [] },
      },
      'azure',
    )

    expect(patched.$schema).toBe('./node_modules/nx/schemas/nx-schema.json')
    expect(patched.namedInputs).toEqual({ default: [] })
    expect(patched.defaultBase).toBe('main')
    expect(patched.release).toMatchObject({
      projectsRelationship: 'independent',
      // Both publishable dirs, in one flat list — not two named release
      // groups: Nx hard-errors the whole release when any explicit group
      // matches zero projects, which a Python-only (or npm-only) workspace
      // would hit immediately. Each project's own versionActions (npm's
      // default, or the hand-written PythonVersionActions stamped onto every
      // python-lib by add/python.ts) wins over this shared config anyway.
      // `!tag:type:go-lib` is a bug fix, not tuning: a go-lib also lands in
      // packages/ but has no per-project manifest (one root go.mod), so Nx's
      // default versionActions looks for a package.json that is not there and
      // aborts the release for the WHOLE workspace. Verified: without this,
      // one `mnci add go-lib` made `nx release` exit 1 for every project.
      // `tag:type:vscode-extension`: an extension lives in apps/ and is released
      // anyway; a tag matcher survives `mnci upgrade`, a hand-added path does not.
      // `tag:release:go`: a Go app is released only when it opts in
      // (`mnci add go-app --release`), by tag, for the same reason.
      projects:             ['packages/*', 'python-packages/*', 'tag:type:vscode-extension', 'tag:release:go', '!tag:type:go-lib'],
      releaseTag:           { pattern: '{projectName}@{version}' },
      // Tag-only model: nothing is ever committed to main; the tag is pushed.
      // Top-level (not version.git) — Nx rejects granular git config for the
      // combined `nx release` command, which is what CI and release:preview
      // both run (never the bare `nx release version` subcommand).
      // push: false for azure/both: GitHub Release creation (which requires
      // push: true) is scoped to the github-only provider — see releaseConfig's
      // remarks for why azure/both keep the pipeline's own explicit tag push.
      git:                  { commit: false, tag: true, push: false },
      version:              {
        conventionalCommits:            true,
        fallbackCurrentVersionResolver: 'disk',
        // Releasing packages must not require building apps; both globs listed
        // (nx run-many no-ops on an empty one).
        preVersionCommand:              'npx nx run-many -t build --projects=packages/*,python-packages/*,tag:type:vscode-extension',
        // The first release of two NEW interdependent packages 404s without
        // this: @nx/js resyncs package-lock.json against the registry after
        // versioning, and one of the two packages does not exist there yet.
        versionActionsOptions:          { skipLockFileUpdate: true },
      },
      changelog: { workspaceChangelog: false },
    })
  })

  it('turns off preserveMatchingDependencyRanges, which refuses the first bump of an internal dependency (#345)', () => {
    // Packages start at 0.0.1 and npm writes ^0.0.1 for an internal dependency, which on 0.0.x matches
    // that version alone. git.commit is false, so the range on disk never moves, and with the setting on
    // nx refuses the first release in its version phase, before anything is tagged.
    for (const ci of ['github', 'azure', 'both'] as const) {
      const version = (withReleaseConfig({ $schema: 'x' }, ci).release as { version: Record<string, unknown> }).version

      expect(version.preserveMatchingDependencyRanges).toBe(false)
    }
  })

  it('turns it off in a workspace generated before the fix, which has a release block without it (#345)', () => {
    const existing = { $schema: 'x', release: { projectsRelationship: 'independent', version: { conventionalCommits: true } } }

    const version = (withReleaseConfig(existing, 'github').release as { version: Record<string, unknown> }).version

    expect(version.preserveMatchingDependencyRanges).toBe(false)
  })

  it('skips the lock file resync, which cannot succeed on the release that needs it', () => {
    // Reported as a `preVersionCommand` problem; it is not. mnci overrides
    // `preVersionCommand` with a build, and the resync comes from `@nx/js`'s
    // `afterAllProjectsVersioned` hook, which shells `npm install
    // --package-lock-only` AFTER every project is versioned. That resolves the
    // whole tree against the registry, so the first release of two new
    // interdependent packages 404s: A depends on B at the version this run is
    // about to publish, and B is not on the registry yet.
    //
    // Asserted for every CI provider, because the failure has nothing to do
    // with which pipeline runs it.
    for (const ci of ['github', 'azure', 'both'] as const) {
      const version = (withReleaseConfig({ $schema: 'x' }, ci).release as {
        version: { versionActionsOptions?: { skipLockFileUpdate?: boolean } }
      }).version
      expect(version.versionActionsOptions).toEqual({ skipLockFileUpdate: true })
    }
  })

  it('adds the lock file skip to a workspace generated before the fix', () => {
    // The path that matters for existing repos: they already carry a `release`
    // block with a `version` object, and `mnci upgrade` has to reach INSIDE it
    // rather than leaving the old object alone. Their own keys must survive.
    const existing = {
      $schema: 'x',
      release: {
        projectsRelationship: 'independent',
        version:              { conventionalCommits: true, somethingTheyAdded: 42 },
      },
    }

    const version = (withReleaseConfig(existing, 'github').release as {
      version: Record<string, unknown>
    }).version

    expect(version.versionActionsOptions).toEqual({ skipLockFileUpdate: true })
    expect(version.somethingTheyAdded).toBe(42)
  })

  it('does the same for both (GitHub Releases are not safe to assume when Azure Pipelines might be the one that runs)', () => {
    const patched = withReleaseConfig({ $schema: 'x' }, 'both')
    expect(patched.release).toMatchObject({
      git:       { commit: false, tag: true, push: false },
      changelog: { workspaceChangelog: false },
    })
  })

  it('turns on GitHub Release creation for the github-only provider', () => {
    const patched = withReleaseConfig({ $schema: 'x' }, 'github')

    expect(patched.release).toMatchObject({
      // Nx hard-errors createRelease when push is disabled — push: true is
      // required here, not optional, and Nx's own push now runs after
      // tagging on this Nx version (verified empirically), so this is safe.
      git:       { commit: false, tag: true, push: true },
      changelog: {
        workspaceChangelog: false,
        // file: false: the changelog content still flows into the GitHub
        // Release body, but no CHANGELOG.md is written — one would never get
        // committed under this tag-only model (git.commit stays false).
        projectChangelogs:  { createRelease: 'github', file: false },
      },
    })
  })

  it('starts the first GitHub Release changelog from the first commit (#243)', () => {
    // Measured: on a repository with no release tag, nx release versions the
    // project and then dies in the changelog step ("Unable to determine the
    // previous git tag"), so the first release of every github workspace failed.
    const github = withReleaseConfig({ $schema: 'x' }, 'github').release as {
      changelog: Record<string, unknown>
    }
    expect(github.changelog.automaticFromRef).toBe(true)

    // No GitHub Release, no project changelog, nothing that needs a from-ref.
    for (const ci of ['azure', 'both'] as const) {
      const release = withReleaseConfig({ $schema: 'x' }, ci).release as {
        changelog: Record<string, unknown>
      }
      expect(release.changelog.automaticFromRef).toBeUndefined()
    }
  })

  it('reaches an existing workspace on upgrade, alongside its own changelog keys', () => {
    const release = withReleaseConfig(
      { release: { changelog: { workspaceChangelog: false, renderOptions: { authors: false } } } },
      'github',
    ).release as { changelog: Record<string, unknown> }

    expect(release.changelog.automaticFromRef).toBe(true)
    expect(release.changelog.renderOptions).toEqual({ authors: false })
  })

  it('releases VS Code extensions by tag and builds them before versioning (#229)', () => {
    const release = withReleaseConfig({ $schema: 'x' }, 'azure').release as {
      projects: string[]
      version:  { preVersionCommand: string }
    }

    expect(release.projects).toContain(`tag:${VSCODE_EXTENSION_TAG}`)
    expect(release.version.preVersionCommand).toContain(`tag:${VSCODE_EXTENSION_TAG}`)
    // A path an extension owner added by hand is replaced (arrays are owned), which
    // is exactly why the scope is a tag matcher: the same list on every upgrade.
    const upgraded = withReleaseConfig(
      { release: { projects: ['packages/*', 'apps/my-extension'] } },
      'azure',
    ).release as { projects: string[] }
    expect(upgraded.projects).toContain(`tag:${VSCODE_EXTENSION_TAG}`)
  })
})

describe('VSCE_PAT in the release step', () => {
  it('reaches the release step in both providers, gated in the script rather than the YAML', () => {
    // Unconditional: the publish target exists in every extension and skips by
    // itself when the secret is unset (Nx throws when no project in a release
    // group carries nx-release-publish, so the target cannot be conditional).
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')
    const workflow = githubActionsYaml('ubuntu-latest', undefined, 'npm', 'github')

    expect(pipeline).toContain('VSCE_PAT: $(VSCE_PAT)')
    expect(workflow).toContain('VSCE_PAT: ${{ secrets.VSCE_PAT }}')
  })
})

describe('Microsoft Entra ID for the Marketplace (#253)', () => {
  interface Step { uses?: string; run?: string; name?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string> }

  for (const ci of ['github', 'both'] as const) {
    it(`signs in through OIDC just before the release step, on main, only when configured and an extension exists (--ci ${ci})`, () => {
      const document_ = yaml.load(githubActionsYaml('ubuntu-latest', undefined, 'npm', ci)) as {
        permissions: Record<string, string>
        jobs:        { ci: { steps: Step[] } }
      }
      const steps = document_.jobs.ci.steps
      const login = steps.findIndex(step => step.uses?.startsWith('azure/login@'))
      const release = steps.findIndex(step => step.name?.startsWith('Release — version, tag'))

      expect(document_.permissions['id-token']).toBe('write')
      expect(steps[login].uses).toBe(`azure/login@${ACTION_VERSIONS['azure/login']}`)
      expect(login).toBe(release - 1)
      expect(steps[login].if).toBe("${{ github.event_name == 'push' && github.ref_name == 'main' && vars.AZURE_CLIENT_ID != '' && hashFiles('apps/*/.vscodeignore') != '' }}")
      expect(steps[login].with).toEqual({
        'client-id':              '${{ vars.AZURE_CLIENT_ID }}',
        'tenant-id':              '${{ vars.AZURE_TENANT_ID }}',
        'allow-no-subscriptions': true,
      })
      // The script publishes with --azure-credential on this signal, never on a
      // stored secret.
      expect(steps[release].env!.VSCE_AUTH).toBe("${{ vars.AZURE_CLIENT_ID != '' && 'entra' || '' }}")
      expect(steps[release].env!.VSCE_PAT).toBe('${{ secrets.VSCE_PAT }}')
    })
  }

  it('leaves Azure Pipelines on VSCE_PAT', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    expect(pipeline).not.toContain('azure/login')
    expect(pipeline).not.toContain('VSCE_AUTH')
  })
})

describe('poolBlock', () => {
  it('maps a Microsoft-hosted image to vmImage', () => {
    expect(poolBlock('ubuntu-latest')).toBe('  vmImage: ubuntu-latest')
    expect(poolBlock('windows-2022')).toBe('  vmImage: windows-2022')
    expect(poolBlock('macos-13')).toBe('  vmImage: macos-13')
  })

  it('maps anything else to a self-hosted pool name', () => {
    expect(poolBlock('MyLinuxPool')).toBe('  name: MyLinuxPool')
    expect(poolBlock('AzurePipelineManagedPool-Windows')).toBe(
      '  name: AzurePipelineManagedPool-Windows',
    )
  })
})

describe('azurePipelinesYaml', () => {
  it('stamps the chosen agent and variable group', () => {
    expect(azurePipelinesYaml('ubuntu-latest', 'Build')).toContain('  vmImage: ubuntu-latest')
    const selfHosted = azurePipelinesYaml('MyPool', 'CiSecrets')
    expect(selfHosted).toContain('  name: MyPool')
    expect(selfHosted).toContain('- group: CiSecrets')
  })

  it('is valid YAML for both hosted and self-hosted agents', () => {
    for (const agent of ['ubuntu-latest', 'MyPool']) {
      const document_ = yaml.load(azurePipelinesYaml(agent, 'Build')) as {
        steps?:     unknown
        pool?:      unknown
        variables?: unknown
      }
      expect(Array.isArray(document_.steps)).toBe(true)
      expect(document_.pool).toBeTruthy()
      expect(Array.isArray(document_.variables)).toBe(true)
    }
  })

  it('re-attaches the detached HEAD before fetching refs or releasing', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    const checkoutIndex = pipeline.indexOf('checkout: self')
    const attachIndex = pipeline.indexOf('git checkout -B $(Build.SourceBranchName)')
    const fetchIndex = pipeline.indexOf('git fetch --all --prune --tags')
    const verifyIndex = pipeline.indexOf('npx mnci ci verify')
    const releaseIndex = pipeline.indexOf('npx mnci ci release')

    expect(checkoutIndex).toBeGreaterThan(-1)
    expect(attachIndex).toBeGreaterThan(checkoutIndex)
    expect(fetchIndex).toBeGreaterThan(attachIndex)
    expect(verifyIndex).toBeGreaterThan(fetchIndex)
    expect(releaseIndex).toBeGreaterThan(verifyIndex)
  })

  describe('build-identity npm auth', () => {
    type Step = { task?: string; script?: string; displayName?: string; env?: Record<string, string>; inputs?: Record<string, string> }
    const stepsOf = (pipeline: string): Step[] =>
      (yaml.load(pipeline) as { steps: Step[] }).steps

    it('runs npmAuthenticate@0 against .npmrc, and strictly before npm ci', () => {
      const steps = stepsOf(azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'azure-artifacts', undefined, 'build-identity'))
      const auth = steps.findIndex(step => step.task === 'npmAuthenticate@0')
      const install = steps.findIndex(step => step.script === 'npm ci')

      expect(auth).toBeGreaterThan(-1)
      expect(steps[auth].inputs?.workingFile).toBe('.npmrc')
      // The order is the whole feature: the task writes the credential into the file
      // npm reads, so a task after the install authenticates nothing that matters.
      expect(install).toBeGreaterThan(auth)
    })

    it('does not hand npm ci a PAT it will never read', () => {
      const steps = stepsOf(azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'azure-artifacts', undefined, 'build-identity'))

      expect(steps.find(step => step.script === 'npm ci')?.env).toBeUndefined()
    })

    it('still maps PAT where Python and NuGet publishing genuinely need it', () => {
      // Build identity replaces npm's credential only. The twine and NuGet paths
      // read the raw PAT from the same variable group, so the release step keeps it.
      const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'azure-artifacts', undefined, 'build-identity')

      expect(pipeline).toContain('PAT: $(PAT)')
    })

    it('adds nothing to the default pipeline', () => {
      const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

      expect(pipeline).not.toContain('npmAuthenticate')
      expect(stepsOf(pipeline).find(step => step.script === 'npm ci')?.env).toEqual({ PAT: '$(PAT)' })
    })
  })

  it('authenticates npm via the base64 PAT env, not npmAuthenticate', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    expect(pipeline).toContain('persistCredentials: true')
    expect(pipeline).toContain('git config user.name')
    expect(pipeline).toContain('PAT: $(PAT)')
    expect(pipeline).not.toContain('npmAuthenticate')
    expect(pipeline).not.toContain('NODE_AUTH_TOKEN')
    expect(pipeline).toContain("in(variables['Build.Reason'], 'IndividualCI', 'BatchedCI')")
    expect(pipeline).toContain("eq(variables['Build.SourceBranchName'], 'main')")
  })

  it('declares RELEASE_SPECIFIER as a pipeline variable defaulting to empty, and reads it in the release step', () => {
    // Azure's $(NAME) macro stays UNEXPANDED literal text when the named
    // variable does not exist at all, rather than expanding to empty — so the
    // variable must be declared with a default, not left for the user to
    // define from scratch, or an unconfigured workspace would feed the
    // literal string '$(RELEASE_SPECIFIER)' into the release guard's regex.
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    expect(pipeline).toContain("- name: RELEASE_SPECIFIER\n    value: ''")
    expect(pipeline).toContain('RELEASE_SPECIFIER: $(RELEASE_SPECIFIER)')
  })

  it('overrides @nx/react\'s express peer with the range @nx/node itself declares', () => {
    // @nx/react@23.1.2 added `express: ^4.21.2` as an optional peer in a PATCH
    // release; 23.1.1 declares none. mnci's own `node-app --framework express`
    // installs express 5, so `npm install` fails outright with ERESOLVE. The
    // generated manifest pins `@nx/react: ^23.1.1`, which ADMITS 23.1.2 — so the
    // same manifest resolves differently depending on when npm runs, which is
    // why CI hit it and a local install with a warm cache did not.
    //
    // The range is not invented here: it is @nx/node@23.2.1's own declared
    // `peerOptional express`, and @nx/node is the package that scaffolds the
    // express app. Both majors satisfy it, which is what lets this be static.
    expect(NX_PEER_OVERRIDES).toEqual({ '@nx/react': { express: '>=4.0.0 <6.0.0' } })
  })

  it('is UNCONDITIONAL, because the conditional form could only be written too late', () => {
    // This is the whole fix, so it is asserted rather than left to the comment.
    // `nx g @nx/node:application --framework=express` adds express to the root
    // manifest AND runs `npm install` in the same invocation, so the ERESOLVE
    // fires inside that generator — before any post-generation step of mnci's
    // can write an override that depends on express already being declared.
    // A `$express` value cannot be written ahead of time either: npm reports
    // `Unable to resolve reference $express` when no express is declared, which
    // would break every react-only workspace. Measured, the four candidates:
    //   '$express'       express5 ok  express4 ok  react-only FAILS
    //   '*'              express5 FAILS
    //   '^5.1.0'                      express4 FAILS
    //   '>=4.0.0 <6.0.0' express5 ok  express4 ok  react-only ok
    const values = Object.values(NX_PEER_OVERRIDES['@nx/react'])
    expect(values.some(value => value.includes('$'))).toBe(false)

    // And it reaches a real generated manifest that mentions neither express nor
    // react — exactly the case the old conditional form wrote nothing for.
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-peer-'))
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ $schema: 's', namedInputs: {} }))
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: '@org/source', private: true, devDependencies: { nx: '23.0.0' } }),
    )
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         DEFAULT_STACK,
    })
    const written = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      overrides: Record<string, unknown>
    }
    expect(written.overrides['@nx/react']).toEqual({ express: '>=4.0.0 <6.0.0' })
  })

  it('gates every release-only step on a CI push to main, never merely "not a PR"', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    // The Azure half of #22, and the more exposed of the two. GitHub's
    // `!= 'pull_request'` needed someone to add a trigger before it could
    // misfire; Azure's `ne(Build.Reason, 'PullRequest')` was wrong on the day it
    // was written, because Azure documents EIGHT non-PR reasons — Manual,
    // Schedule, IndividualCI, BatchedCI, BuildCompletion, ResourceTrigger,
    // ValidateShelveset, CheckInShelveset. Clicking *Run pipeline* on `main` is
    // an ordinary Azure workflow, and it would have published.
    expect(pipeline).toContain("in(variables['Build.Reason'], 'IndividualCI', 'BatchedCI')")
    expect(pipeline).not.toContain("ne(variables['Build.Reason'], 'PullRequest')")
  })

  it('lists BOTH CI reasons, because dropping either stops releases silently', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    // The failure mode in the other direction, and the reason this item waited
    // for evidence rather than a careful guess: narrowing to one reason does not
    // fail loudly, it just never releases again while the pipeline stays green.
    //
    // `BatchedCI` is coupled to the trigger below — Azure documents it as the
    // reason for "a Git push ... and the Batch changes was selected", which is
    // exactly what `batch: true` selects. `IndividualCI` stays because batching
    // only applies once a run is already in progress, so an unbatched push is
    // still the ordinary case. Asserted together so the coupling cannot be
    // broken by editing one of them.
    expect(pipeline).toContain("'IndividualCI'")
    expect(pipeline).toContain("'BatchedCI'")
    expect(pipeline).toContain('batch: true')
  })

  it('gates exactly the four release-only steps, the same set as GitHub plus the per-app build tag', () => {
    // Both providers share one condition across pack, publish and release (the release
    // command now does the shallow-clone guard, the preflights and the tag push inside it);
    // Azure adds the per-app build tag. Asserting the COUNT is what
    // stops the narrowing from silently reaching a step it was never meant
    // to gate — or missing one it was. The .NET SDK install task also
    // carries a 'condition:' — a different gate (does the workspace have
    // any C# project) for a different reason — so this matches the release
    // condition's exact text rather than mere presence, or the two would be
    // indistinguishable here.
    const document_ = yaml.load(azurePipelinesYaml('ubuntu-latest', 'Build')) as {
      steps: { condition?: string; displayName?: string }[]
    }
    const releaseCondition =
      "and(succeeded(), in(variables['Build.Reason'], 'IndividualCI', 'BatchedCI'), " +
      "eq(variables['Build.SourceBranchName'], 'main'))"
    const gated = document_.steps.filter(step => step.condition === releaseCondition)

    expect(gated.map(step => step.displayName)).toEqual([
      'Pack all apps (one zip per app -> dist/drop)',
      'Publish the drop (one zip per app)',
      'Tag the run per app (type-name)',
      'Release — version, tag and publish (npm + Python + C# + VS Code)',
    ])
  })

  it('gates the .NET SDK install task on the workspace having a C# project, not on main', () => {
    // Distinct from the release condition above: this must run on every
    // branch and PR — a C# project needs the SDK to build/test/lint long
    // before anything releases — so it cannot reuse onMain.
    const document_ = yaml.load(azurePipelinesYaml('ubuntu-latest', 'Build')) as {
      steps: { task?: string; condition?: string; inputs?: { version?: string } }[]
    }
    const install = document_.steps.find(step => step.task === 'UseDotNet@2')

    expect(install?.condition).toBe("eq(variables['hasDotnetProjects'], 'true')")
    expect(install?.inputs?.version).toBe(DOTNET_SDK_VERSION)
  })

  it('authenticates npm via NODE_AUTH_TOKEN (an NPM_TOKEN variable), not PAT, for the public npm registry', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'npm')

    expect(pipeline).toContain('NODE_AUTH_TOKEN: $(NPM_TOKEN)')
    expect(pipeline).not.toContain('PAT: $(PAT)')
    // Still reads secrets from the same Library variable group — only the
    // variable name inside it differs, so no new CLI-collected value is needed.
    expect(pipeline).toContain('- group: Build')
  })

  it('never writes a pr: branch filter, which Azure Repos Git ignores outright', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')
    const document_ = yaml.load(pipeline) as { pr?: unknown }

    // The whole point: a `pr:` block with branch filters is NOT an error on
    // Azure Repos, it is silently ignored — so writing one documents a gate
    // that never runs. `pr: none` states the same truth without the lie.
    expect(document_.pr).toBe('none')
    expect(pipeline).not.toContain('pr:\n  branches:')
    // The remedy has to be named where someone will look for it, or removing
    // the block just leaves an unexplained hole.
    expect(pipeline).toContain('Build Validation')
    expect(pipeline).toContain('System.PullRequest.TargetBranch')
  })

  it('triggers CI on every branch, since pr: cannot cover them on Azure Repos', () => {
    const document_ = yaml.load(azurePipelinesYaml('ubuntu-latest', 'Build')) as {
      trigger?: { batch?: boolean; branches?: { include?: string[] } }
    }

    // main alone would mean a topic branch is verified by nothing at all,
    // because the `pr:` block that used to sit next to it never ran.
    expect(document_.trigger?.branches?.include).toContain('*')
    expect(document_.trigger?.branches?.include).toContain('main')
    expect(document_.trigger?.batch).toBe(true)
  })

  it('gates every release step on main, so a topic-branch run publishes nothing', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    // Pairs with the all-branches trigger above: CI everywhere is only safe
    // while the publishing half stays pinned to main.
    for (const releaseStep of [
      'Pack all apps',
      'Publish the drop',
      'Release — version, tag and publish',
    ]) {
      const at = pipeline.indexOf(releaseStep)
      expect(at).toBeGreaterThan(-1)
      expect(pipeline.slice(at, at + 400)).toContain(
        "eq(variables['Build.SourceBranchName'], 'main')",
      )
    }
  })

  it('does not reference any custom CI engine — the pipeline is plain Nx', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    expect(pipeline).not.toContain('build-templates')
    expect(pipeline).not.toContain('monecromanci-toolchain')
    expect(pipeline).not.toContain('.mjs')
  })

  it('is cross-platform: no multi-line shell blocks, no bash-isms, no PowerShell', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    // Every script step must be a single-line command (cmd.exe and sh both
    // run it); a block scalar would mean OS-specific shell scripting.
    expect(pipeline).not.toContain('script: |')
    expect(pipeline).not.toContain('shopt')
    expect(pipeline).not.toContain('for host in')
    expect(pipeline).not.toContain('if [')
    expect(pipeline).not.toContain('powershell')
    expect(pipeline).not.toContain('pwsh')
  })

  it('has no standalone lint step, a strict subset of the verify target list', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    // `npm run lint` is `nx run-many -t lint`. Keeping it alongside a verify step
    // that already runs `lint` only duplicates work — and worse, on an
    // affected-scoped PR it would re-lint EVERY project, discarding most of what
    // the affected selection buys.
    expect(pipeline).not.toContain('script: npm run lint')
  })

  it('batches pushes to main, so two nx release runs cannot race for the same tag', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    // Azure's nearest YAML equivalent to a concurrency group. PR-run cancellation
    // is a branch-policy setting with no YAML expression, so it is deliberately
    // not faked here — see the comment in the generated file.
    expect(pipeline).toContain('batch: true')
  })

  it('caches npm downloads, keyed on the lockfile and the agent OS', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    // Azure has no `cache: npm` equivalent, so this is the documented Cache@2
    // pattern: npm's cache is relocated into the pipeline workspace (the default
    // ~/.npm is outside the cacheable area) and keyed on package-lock.json.
    expect(pipeline).toContain('- name: npm_config_cache')
    expect(pipeline).toContain('value: $(Pipeline.Workspace)/.npm')
    expect(pipeline).toContain('task: Cache@2')
    expect(pipeline).toContain('npm | "$(Agent.OS)" | package-lock.json')
    // A cached native module built for one OS is not reusable on another.
    expect(pipeline).toContain('"$(Agent.OS)"')
  })

  it('restores the cache before npm ci, or it would install cold anyway', () => {
    const pipeline = azurePipelinesYaml('ubuntu-latest', 'Build')

    expect(pipeline.indexOf('task: Cache@2')).toBeLessThan(pipeline.indexOf('script: npm ci'))
  })
})

describe('githubActionsYaml', () => {
  it('stamps the chosen agent as runs-on', () => {
    expect(githubActionsYaml('ubuntu-latest')).toContain('runs-on: ubuntu-latest')
    expect(githubActionsYaml('MyRunnerLabel')).toContain('runs-on: MyRunnerLabel')
  })

  it('is valid YAML with the expected top-level shape', () => {
    const document_ = yaml.load(githubActionsYaml('ubuntu-latest')) as {
      on?:          { push?: unknown; pull_request?: unknown }
      permissions?: { contents?: string }
      jobs?:        { ci?: { steps?: unknown[] } }
    }
    expect(document_.on?.push).toBeTruthy()
    expect(document_.on?.pull_request).toBeTruthy()
    expect(document_.permissions?.contents).toBe('write')
    expect(Array.isArray(document_.jobs?.ci?.steps)).toBe(true)
  })

  it('cancels superseded PR runs but never a release run on main', () => {
    const document_ = yaml.load(githubActionsYaml('ubuntu-latest')) as {
      concurrency?: { 'group'?: string; 'cancel-in-progress'?: string }
    }

    expect(document_.concurrency?.group).toBe('${{ github.workflow }}-${{ github.ref }}')
    // An expression, deliberately, not a flat `true`. A cancelled run on main can
    // leave a release tag pushed with the publish only half done — a state no
    // rerun repairs, because the version is already tagged. Those runs queue.
    expect(document_.concurrency?.['cancel-in-progress']).toBe(
      "${{ github.event_name == 'pull_request' }}",
    )
  })

  it('gates every release-only step on a PUSH to main, never merely "not a PR"', () => {
    const workflow = githubActionsYaml('ubuntu-latest')

    // The positive form is load-bearing even though it is equivalent today: the
    // generated workflow has exactly two triggers, so `!= 'pull_request'` means
    // `== 'push'` right now. It stops meaning that the moment anyone adds a
    // `workflow_dispatch` or a `schedule`, at which point clicking *Run workflow*
    // would publish packages and push release tags with nothing in the file
    // suggesting it could. mnci's own workflow hit exactly that, having hand-added
    // `workflow_dispatch` for its Windows e2e job.
    expect(workflow).toContain("github.event_name == 'push' && github.ref_name == 'main'")
    expect(workflow).not.toContain("github.event_name != 'pull_request'")
  })

  it('does not attach HEAD to a branch (actions/checkout is never detached on a push-triggered run)', () => {
    const workflow = githubActionsYaml('ubuntu-latest')
    expect(workflow).toContain('actions/checkout@v7')
    expect(workflow).not.toContain('checkout -B')
  })

  it('installs the .NET SDK via actions/setup-dotnet, gated on the workspace having a C# project', () => {
    // hashFiles(), not onMain: a C# project needs the SDK to build/test/lint
    // on every branch and PR, long before anything releases — the opposite
    // gate from the release-only steps above.
    const document_ = yaml.load(githubActionsYaml('ubuntu-latest')) as {
      jobs?: { ci?: { steps?: { uses?: string; if?: string; with?: Record<string, string> }[] } }
    }
    const install = document_.jobs?.ci?.steps?.find(step => step.uses === 'actions/setup-dotnet@v6')

    expect(install?.if).toBe("${{ hashFiles('apps/*/*.csproj', 'packages/*/*.csproj', 'libs/*/*.csproj') != '' }}")
    expect(install?.with?.['dotnet-version']).toBe(DOTNET_SDK_VERSION)
  })

  it('authenticates npm via a PAT repository secret, not a variable group', () => {
    const workflow = githubActionsYaml('ubuntu-latest')

    expect(workflow).toContain('secrets.PAT')
    expect(workflow).not.toContain('npmAuthenticate')
    expect(workflow).not.toContain('- group:')
    expect(workflow).not.toContain('NODE_AUTH_TOKEN')
  })

  it('authenticates npm via NODE_AUTH_TOKEN (an NPM_TOKEN secret), not PAT, for the public npm registry', () => {
    const workflow = githubActionsYaml('ubuntu-latest', undefined, 'npm')

    expect(workflow).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}')
    expect(workflow).not.toContain('secrets.PAT')
  })

  it('reads RELEASE_SPECIFIER from a repository variable, not a secret', () => {
    // A repository variable, not a secret: RELEASE_SPECIFIER overrides a
    // computed bump, so it belongs where anyone can see and edit it without
    // "secret" write access.
    const workflow = githubActionsYaml('ubuntu-latest')

    expect(workflow).toContain('RELEASE_SPECIFIER: ${{ vars.RELEASE_SPECIFIER }}')
  })

  it('does not reference any custom CI engine — the workflow is plain Nx', () => {
    const workflow = githubActionsYaml('ubuntu-latest')

    expect(workflow).not.toContain('build-templates')
    expect(workflow).not.toContain('monecromanci-toolchain')
    expect(workflow).not.toContain('.mjs')
  })

  it('has no standalone lint step, a strict subset of the verify target list', () => {
    const workflow = githubActionsYaml('ubuntu-latest')

    expect(workflow).not.toContain('run: npm run lint')
  })

  it('creates GitHub Releases and lets nx push its own tag when github is the only provider', () => {
    const workflow = githubActionsYaml('ubuntu-latest', undefined, 'azure-artifacts', 'github')

    expect(workflow).toContain('GITHUB_TOKEN')
    expect(workflow).toContain('secrets.GITHUB_TOKEN')
    // Nx pushes the tag itself now (release.git.push: true) — the pipeline's
    // own explicit push step would be redundant, so it must be gone.
    expect(workflow).not.toContain('git push origin --tags')
  })

  it('defaults to the github-only behaviour when ci is omitted', () => {
    const withDefault = githubActionsYaml('ubuntu-latest')
    const withExplicit = githubActionsYaml('ubuntu-latest', undefined, 'azure-artifacts', 'github')
    expect(withDefault).toBe(withExplicit)
  })

  it('skips GitHub Release creation when both providers are configured, leaving the tag push to the release phase', () => {
    const workflow = githubActionsYaml('ubuntu-latest', undefined, 'azure-artifacts', 'both')
    expect(() => yaml.load(workflow)).not.toThrow()

    expect(workflow).not.toContain('GITHUB_TOKEN')
    expect(workflow).toContain('npx mnci ci release')
  })
})

describe('native (cgo) apps in the pipelines (#263)', () => {
  interface Step { name?: string; displayName?: string; run?: string; script?: string; if?: string; condition?: string; uses?: string }
  interface GithubJob { 'needs'?: string; 'runs-on': string; 'strategy'?: { 'fail-fast': boolean; 'matrix': { os: string[] } }; 'steps': Step[] }
  interface AzureJob { job: string; dependsOn?: string; pool: Record<string, string>; strategy?: { matrix: Record<string, Record<string, string>> }; steps: Step[] }

  const github = (native: boolean): { jobs: Record<string, GithubJob> } =>
    yaml.load(githubActionsYaml('ubuntu-latest', undefined, 'npm', 'github', undefined, native)) as { jobs: Record<string, GithubJob> }
  const azure = (native: boolean): { jobs?: AzureJob[]; steps?: Step[]; pool?: Record<string, string>; variables?: unknown[] } =>
    yaml.load(azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'npm', undefined, 'pat', native)) as ReturnType<typeof azure>
  const verifyOf = (steps: Step[]): Step | undefined => steps.find(step => (step.name ?? step.displayName ?? '').startsWith('Verify ('))
  const without = (steps: Step[]): Step[] => steps.filter(step => !(step.name ?? step.displayName ?? '').startsWith('Verify ('))

  describe('hasNativeGoApp', () => {
    let workspace: string

    beforeEach(() => {
      workspace = mkdtempSync(join(tmpdir(), 'mnci-native-'))
    })

    afterEach(() => rmSync(workspace, { force: true, recursive: true }))

    /** Writes `apps/<name>/project.json` with the given raw content. */
    function project (name: string, content: string): void {
      mkdirSync(join(workspace, 'apps', name), { recursive: true })
      writeFileSync(join(workspace, 'apps', name, 'project.json'), content)
    }

    it('is true only when an app carries the build:cgo tag', () => {
      project('tool', JSON.stringify({ tags: ['type:go-app'] }))
      expect(hasNativeGoApp(workspace)).toBe(false)

      project('tray', JSON.stringify({ tags: ['type:go-app', 'build:cgo'] }))
      expect(hasNativeGoApp(workspace)).toBe(true)
    })

    it('is false with no apps folder, and for a project file it cannot read', () => {
      expect(hasNativeGoApp(workspace)).toBe(false)

      project('broken', '{ not json')
      expect(hasNativeGoApp(workspace)).toBe(false)
    })
  })

  describe('a workspace without a native app', () => {
    it('gets exactly the pipelines it had before, for both providers', () => {
      expect(githubActionsYaml('ubuntu-latest', undefined, 'npm', 'github', undefined, false))
        .toBe(githubActionsYaml('ubuntu-latest', undefined, 'npm', 'github'))
      expect(azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'npm', undefined, 'pat', false))
        .toBe(azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'npm'))
    })

    it('has no native job and does not exclude anything from verify', () => {
      expect(Object.keys(github(false).jobs)).toEqual(['ci'])
      expect(azure(false).jobs).toBeUndefined()
    })
  })

  describe('GitHub Actions, with a native app', () => {
    it('adds a native job after ci, one leg per OS, that does not stop at the first failure', () => {
      const { native } = github(true).jobs

      expect(Object.keys(github(true).jobs)).toEqual(['ci', 'native'])
      expect(native.needs).toBe('ci')
      expect(native['runs-on']).toBe('${{ matrix.os }}')
      expect(native.strategy?.matrix.os).toEqual(['windows-latest', 'macos-latest', 'ubuntu-latest'])
      expect(native.strategy?.['fail-fast']).toBe(false)
    })

    it('changes nothing in the ci job, whose verify command leaves the native apps out itself', () => {
      const plain = github(false).jobs.ci.steps
      const withNative = github(true).jobs.ci.steps

      expect(verifyOf(withNative)?.run).toBe('npx mnci ci verify')
      expect(without(withNative)).toEqual(without(plain))
    })

    it('runs the native phase on each leg, which attaches a releasable app\'s zip itself on main', () => {
      const { steps } = github(true).jobs.native
      const build = steps.find(step => step.run === 'npx mnci ci native')

      expect(build).toBeDefined()
      // The Linux packages are installed by the phase, from nx.json, not by a YAML step.
      expect(steps.some(step => step.name?.includes('native prerequisites'))).toBe(false)
      expect(steps.some(step => step.uses?.startsWith('actions/upload-artifact@'))).toBe(true)
    })
  })

  describe('Azure Pipelines, with a native app', () => {
    it('moves the single job under jobs: untouched, and adds the native job after it', () => {
      const plain = azure(false)
      const document = azure(true)

      expect(document.steps).toBeUndefined()
      expect(document.pool).toBeUndefined()
      expect(document.variables).toEqual(plain.variables)
      expect(document.jobs?.map(each => each.job)).toEqual(['ci', 'native'])
      expect(document.jobs?.[0].pool).toEqual(plain.pool)
      expect(without(document.jobs?.[0].steps ?? [])).toEqual(without(plain.steps ?? []))
      expect(verifyOf(document.jobs?.[0].steps ?? [])?.script).toBe('npx mnci ci verify')
    })

    it('fans the native job out over a Windows, a macOS and a Linux image, after ci', () => {
      const native = azure(true).jobs?.[1]

      expect(native?.dependsOn).toBe('ci')
      expect(native?.pool).toEqual({ vmImage: '$(vmImage)' })
      expect(Object.values(native?.strategy?.matrix ?? {}).map(leg => leg.vmImage))
        .toEqual(['windows-latest', 'macos-latest', 'ubuntu-latest'])
      expect(native?.steps.find(step => step.script === 'npx mnci ci native')).toBeDefined()
      expect(native?.steps.some(step => step.displayName?.includes('native prerequisites'))).toBe(false)
    })

    it('stays valid in the build-identity mode, whose steps start with a task', () => {
      const document = yaml.load(azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'azure-artifacts', undefined, 'build-identity', true)) as { jobs: AzureJob[] }

      expect(document.jobs.map(each => each.job)).toEqual(['ci', 'native'])
      expect(document.jobs[1].steps.some(step => (step as { task?: string }).task === 'npmAuthenticate@0')).toBe(true)
    })
  })

  describe('the runners of mnci.native', () => {
    it('takes the legs of both providers from the list it is given', () => {
      const runners = ['ubuntu-24.04', 'macos-14']

      const githubDocument = yaml.load(githubActionsYaml('ubuntu-latest', undefined, 'npm', 'github', undefined, true, runners)) as { jobs: Record<string, GithubJob> }
      const azureDocument = yaml.load(azurePipelinesYaml('ubuntu-latest', 'Build', undefined, 'npm', undefined, 'pat', true, runners)) as { jobs: AzureJob[] }

      expect(githubDocument.jobs.native.strategy?.matrix.os).toEqual(runners)
      expect(Object.values(azureDocument.jobs[1].strategy?.matrix ?? {}).map(leg => leg.vmImage)).toEqual(runners)
    })
  })

  describe('applyOverlay', () => {
    let workspace: string

    beforeEach(() => {
      workspace = mkdtempSync(join(tmpdir(), 'mnci-native-overlay-'))
      writeFileSync(join(workspace, 'nx.json'), JSON.stringify({ $schema: 's', namedInputs: {} }))
      writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: '@org/source', private: true, devDependencies: { nx: '23.0.0' } }))
    })

    afterEach(() => rmSync(workspace, { force: true, recursive: true }))

    /** Applies the overlay for both providers, as `mnci upgrade` would. */
    function apply (): void {
      applyOverlay(workspace, {
        workspaceName: 'demo',
        scope:         '@demo',
        registry:      { kind: 'npm' },
        agent:         'ubuntu-latest',
        variableGroup: 'Build',
        ci:            'both',
        stack:         DEFAULT_STACK,
      })
    }

    it('reads the legs from mnci.native.runners in nx.json', () => {
      writeFileSync(join(workspace, 'nx.json'), JSON.stringify({ $schema: 's', namedInputs: {}, mnci: { native: { runners: ['ubuntu-24.04'] } } }))
      mkdirSync(join(workspace, 'apps/tray'), { recursive: true })
      writeFileSync(join(workspace, 'apps/tray/project.json'), JSON.stringify({ tags: ['build:cgo'] }))

      apply()

      expect(readFileSync(join(workspace, '.github/workflows/ci.yml'), 'utf8')).toContain('os: [ubuntu-24.04]')
      expect(readFileSync(join(workspace, 'azure-pipelines.yml'), 'utf8')).toContain('vmImage: ubuntu-24.04')
    })

    it('writes the native job into both pipelines once an app is tagged build:cgo, and not before', () => {
      apply()
      expect(readFileSync(join(workspace, '.github/workflows/ci.yml'), 'utf8')).not.toContain('native:')
      expect(readFileSync(join(workspace, 'azure-pipelines.yml'), 'utf8')).not.toContain('job: native')

      mkdirSync(join(workspace, 'apps/tray'), { recursive: true })
      writeFileSync(join(workspace, 'apps/tray/project.json'), JSON.stringify({ tags: ['build:cgo'] }))
      apply()

      expect(readFileSync(join(workspace, '.github/workflows/ci.yml'), 'utf8')).toContain('native:')
      expect(readFileSync(join(workspace, 'azure-pipelines.yml'), 'utf8')).toContain('job: native')
    })
  })
})

describe('withEslintPlugin', () => {
  it('registers @nx/eslint/plugin, which is what gives every project a lint target', () => {
    // create-nx-workspace does not add this; Nx used to, as an invisible side
    // effect of the first `nx g … --linter=eslint`. mnci passes `--linter=none`
    // now, so without this registration no project would get a lint target at
    // all — and `npm run lint` in a fresh workspace would silently do nothing.
    const patched = withEslintPlugin({ plugins: [{ plugin: '@nx/js/typescript' }] })

    expect(patched.plugins).toEqual([
      { plugin: '@nx/js/typescript' },
      { plugin: '@nx/eslint/plugin', options: { targetName: 'lint' } },
    ])
  })

  it('is idempotent, so `mnci upgrade` cannot accumulate duplicates', () => {
    const once = withEslintPlugin({ plugins: [] })

    expect(withEslintPlugin(once).plugins).toEqual(once.plugins)
  })

  it("leaves an existing registration's own options alone", () => {
    // A workspace generated before this existed has Nx's entry already. Its
    // targetName may have been customised; overwriting it would rename every
    // project's lint target out from under the user's scripts.
    const existing = { plugin: '@nx/eslint/plugin', options: { targetName: 'eslint-check' } }

    expect(withEslintPlugin({ plugins: [existing] }).plugins).toEqual([existing])
  })

  it('handles the bare-string plugin form Nx also accepts', () => {
    expect(withEslintPlugin({ plugins: ['@nx/eslint/plugin'] }).plugins).toEqual([
      '@nx/eslint/plugin',
    ])
  })

  it('copes with an nx.json that has no plugins key at all', () => {
    expect(withEslintPlugin({}).plugins).toEqual([
      { plugin: '@nx/eslint/plugin', options: { targetName: 'lint' } },
    ])
  })
})

describe('devcontainerJson', () => {
  type Devcontainer = {
    name:              string
    image:             string
    features:          Record<string, unknown>
    postCreateCommand: string
    customizations:    { vscode: { extensions: string[] } }
  }
  const parsed = (): Devcontainer => JSON.parse(devcontainerJson('demo')) as Devcontainer

  it('is valid JSON naming the workspace', () => {
    // Written to disk verbatim, so a malformed string would break the container
    // build with no earlier signal.
    expect(parsed().name).toBe('demo')
  })

  it('pins the same Node major the pipeline does, from one constant', () => {
    // The whole point of the file is that local matches CI. Hardcoding the
    // number in two places would reintroduce exactly the drift it removes.
    expect(parsed().image).toBe(
      `mcr.microsoft.com/devcontainers/typescript-node:${NODE_VERSION}-bookworm`,
    )
    expect(githubActionsYaml('ubuntu-latest')).toContain(`node-version: ${NODE_VERSION}`)
  })

  it('pins the same npm major the pipeline does, from one constant', () => {
    // Node was pinned and npm was not, and the gap cost six high advisories in
    // every generated workspace. npm 11 reuses an already-installed tree rather
    // than re-resolving, so it applies `overrides` differently from npm 10 —
    // measured on nx 23.1.1, same manifest, same sequence: npm 10.9.7 reported
    // 0 and npm 11.19.0 reported 6. A contributor on a different npm major
    // therefore verified something other than what users got.
    expect(parsed().postCreateCommand).toContain(`npm install -g npm@${NPM_VERSION}`)
    expect(githubActionsYaml('ubuntu-latest')).toContain(`npm install -g npm@${NPM_VERSION}`)
  })

  it('pins npm BEFORE npm ci, since the pin is pointless after the install', () => {
    const postCreate = parsed().postCreateCommand

    expect(postCreate.indexOf(`npm install -g npm@${NPM_VERSION}`)).toBeLessThan(
      postCreate.indexOf('npm ci'),
    )

    const workflow = githubActionsYaml('ubuntu-latest')

    expect(workflow.indexOf(`npm install -g npm@${NPM_VERSION}`)).toBeLessThan(
      workflow.indexOf('- run: npm ci'),
    )
  })

  it('brings Python, Go and .NET as features rather than a hand-maintained Dockerfile', () => {
    expect(Object.keys(parsed().features)).toEqual([
      'ghcr.io/devcontainers/features/python:1',
      'ghcr.io/devcontainers/features/go:1',
      'ghcr.io/devcontainers/features/dotnet:2',
    ])
  })

  it("pins the .NET feature to DOTNET_SDK_VERSION with the trailing '.x' stripped", () => {
    // The devcontainer feature's own schema takes 'X.Y'/'X.Y.Z', never the
    // '.x' wildcard suffix actions/setup-dotnet and UseDotNet@2 expect — so
    // this derives from the one constant rather than hardcoding a second
    // value that could drift from it.
    const dotnetFeature = parsed().features['ghcr.io/devcontainers/features/dotnet:2'] as {
      version?: string
    }

    expect(dotnetFeature.version).toBe('10.0')
    expect(DOTNET_SDK_VERSION).toBe(`${dotnetFeature.version}.x`)
  })

  it('pins the Go feature and its linter to mnci-controlled values, never latest (#241)', () => {
    // The feature installs golangci-lint at `latest` unless told, and it runs before postCreateCommand, so the
    // guard there used to find that one on PATH and skip the pin.
    expect(parsed().features['ghcr.io/devcontainers/features/go:1']).toEqual({
      version:             GO_VERSION,
      golangciLintVersion: GOLANGCI_LINT_VERSION,
    })
  })

  it("provisions the toolchains with the pipeline's own command instead of a third copy", () => {
    // `npx mnci ci setup` is the command CI runs: idempotent, and a no-op for each language the
    // workspace has no project in, so a JS-only workspace pays almost nothing. Reimplementing it
    // here would be a third place to keep in sync.
    const command = parsed().postCreateCommand

    // `npm ci` comes before it, because the CLI is a devDependency and does not exist until the
    // install completes. It is no longer *first*: the npm pin precedes it, since pinning npm after
    // the install it was meant to govern would achieve nothing.
    expect(command.indexOf('npm ci')).toBeLessThan(command.indexOf('npx mnci ci setup'))
    expect(command.endsWith('npx mnci ci setup')).toBe(true)
  })

  it('recommends the same extensions as the .code-workspace file', () => {
    expect(parsed().customizations.vscode.extensions).toEqual([...VSCODE_RECOMMENDED_EXTENSIONS])
    expect(vscodeWorkspace('demo')).toContain('dbaeumer.vscode-eslint')
    // Ends with a newline like every other JSON file mnci writes; without it,
    // every `mnci upgrade` re-diffed this file against `mnci new`'s formatted copy.
    expect(vscodeWorkspace('demo').endsWith('}\n')).toBe(true)
  })
})

describe('isUnmodifiedMnciEslintConfig', () => {
  // This predicate decides whether an existing eslint.config.mjs may be
  // REPLACED. A false positive deletes work a user did, in the file mnci's own
  // comment told them to edit, and `upgrade` then tells them to run
  // `npm run format` — so the next thing that happens is every file in the
  // repository being rewritten against rules they thought they had overridden.
  //
  // Every case below is therefore about the same question: is this file
  // provably nothing but mnci's own output?
  const OLD_LAYOUT = [
    '// WHAT IS IN HERE. Each line is one config block.',
    '//   mnci/base   JS/TS correctness',
    '',
    "import mnci from '@mnci/eslint-config'",
    '',
    '// TO OVERRIDE a rule, append a block AFTER the spread.',
    'export default mnci({ workspaceRoot: import.meta.dirname })',
    '',
  ].join('\n')

  it('recognises an untouched config generated by an earlier mnci', () => {
    expect(isUnmodifiedMnciEslintConfig(OLD_LAYOUT)).toBe(true)
  })

  it('refuses one with a block appended, which is the whole reason it exists', () => {
    // Built by concatenation rather than `replace`, because a non-literal
    // replacement is itself a lint error here — and the rule is right: a `$&`
    // anywhere in the replacement would be interpreted rather than inserted.
    const edited = [
      '// WHAT IS IN HERE. Each line is one config block.',
      "import mnci from '@mnci/eslint-config'",
      '',
      'export default [',
      '  ...mnci({ workspaceRoot: import.meta.dirname }),',
      "  { name: 'local/legacy', rules: {} },",
      ']',
      '',
    ].join('\n')

    expect(isUnmodifiedMnciEslintConfig(edited)).toBe(false)
  })

  it('refuses one with an extra statement, however harmless it looks', () => {
    expect(isUnmodifiedMnciEslintConfig(`${OLD_LAYOUT}\nexport const extra = 1\n`)).toBe(false)
  })

  it('refuses one that imports anything else', () => {
    const forked = OLD_LAYOUT.replace('@mnci/eslint-config', './my-rules.mjs')

    expect(isUnmodifiedMnciEslintConfig(forked)).toBe(false)
  })

  it('refuses one whose export was changed, even by a single argument', () => {
    const tweaked = OLD_LAYOUT.replace(
      'mnci({ workspaceRoot: import.meta.dirname })',
      "mnci({ workspaceRoot: import.meta.dirname, tsconfig: './tsconfig.json' })",
    )

    expect(isUnmodifiedMnciEslintConfig(tweaked)).toBe(false)
  })

  it('refuses a config already on the split, so upgrade cannot undo the move', () => {
    // The new entry point imports ./eslint.config.mnci.mjs. Treating it as
    // replaceable would rewrite it on every upgrade — the original bug, back.
    expect(isUnmodifiedMnciEslintConfig(ESLINT_USER_CONFIG)).toBe(false)
  })

  it('refuses an empty file and a file of nothing but comments', () => {
    expect(isUnmodifiedMnciEslintConfig('')).toBe(false)
    expect(isUnmodifiedMnciEslintConfig('// just a note\n\n// and another\n')).toBe(false)
  })

  it('accepts the two statements whatever the surrounding whitespace', () => {
    // Indentation and blank lines are not content. An editor that reformatted
    // the file without changing it must not strand a workspace on the old
    // layout for ever.
    const spaced = [
      '',
      "   import mnci from '@mnci/eslint-config'   ",
      '',
      '',
      '  export default mnci({ workspaceRoot: import.meta.dirname })',
      '',
    ].join('\n')

    expect(isUnmodifiedMnciEslintConfig(spaced)).toBe(true)
  })
})

describe('withSharedGlobals', () => {
  it('lists the root config files, so `nx affected` on a PR is not blind to them', () => {
    // Measured on a real workspace before this existed: touching
    // tsconfig.base.json marked ONLY the root pseudo-project, which has no
    // lint/typecheck/test/build target — so `nx affected -t …` verified nothing
    // at all and CI reported green. Each of these three can change every
    // project's result.
    const patched = withSharedGlobals({ namedInputs: { sharedGlobals: [] } })

    // BOTH ESLint files: the rules live in eslint.config.mnci.mjs and the
    // workspace's own blocks in eslint.config.mjs, so a change to either can
    // change every project's result. Listing one would make the other
    // invisible, which is the exact failure this input exists to prevent.
    expect((patched.namedInputs as { sharedGlobals: string[] }).sharedGlobals).toEqual([
      '{workspaceRoot}/eslint.config.mjs',
      '{workspaceRoot}/eslint.config.mnci.mjs',
      '{workspaceRoot}/tsconfig.base.json',
      '{workspaceRoot}/package.json',
    ])
  })

  it('leaves the rest of namedInputs exactly as the preset generated it', () => {
    // `default` is what references sharedGlobals, and `production` extends
    // `default`. Overwriting either would change what every target hashes.
    const preset = {
      default:       ['{projectRoot}/**/*', 'sharedGlobals'],
      production:    ['default', '!{projectRoot}/jest.config.[jt]s'],
      sharedGlobals: [],
    }

    expect(withSharedGlobals({ namedInputs: preset }).namedInputs).toMatchObject({
      default:    preset.default,
      production: preset.production,
    })
  })

  it('is idempotent, so `mnci upgrade` cannot accumulate duplicates', () => {
    const once = withSharedGlobals({ namedInputs: { sharedGlobals: [] } })

    expect(withSharedGlobals(once).namedInputs).toEqual(once.namedInputs)
  })

  it("keeps a workspace's own shared globals rather than replacing them", () => {
    // Additive on purpose: a user who added their own entry (a shared .env, a
    // codegen schema) would otherwise lose it on every `mnci upgrade`.
    const patched = withSharedGlobals({
      namedInputs: { sharedGlobals: ['{workspaceRoot}/schema.graphql'] },
    })

    expect((patched.namedInputs as { sharedGlobals: string[] }).sharedGlobals).toEqual([
      '{workspaceRoot}/schema.graphql',
      ...SHARED_GLOBAL_INPUTS,
    ])
  })

  it('copes with an nx.json that has neither namedInputs nor sharedGlobals', () => {
    expect(withSharedGlobals({}).namedInputs).toEqual({ sharedGlobals: [...SHARED_GLOBAL_INPUTS] })
    expect(withSharedGlobals({ namedInputs: { default: [] } }).namedInputs).toEqual({
      default:       [],
      sharedGlobals: [...SHARED_GLOBAL_INPUTS],
    })
  })

  it('does not list .prettierrc.json or the lockfile, and the reasons differ', () => {
    // Prettier is not a project target — the pipeline's `format:check` step runs
    // `prettier --check .` over the whole tree on every run, so listing it would
    // invalidate every cache and verify nothing new. The lockfile is already
    // covered: Nx marks projects affected from it through its external-dependency
    // nodes (verified on a real workspace — a lockfile-only edit marks all).
    expect(SHARED_GLOBAL_INPUTS).not.toContain('{workspaceRoot}/.prettierrc.json')
    expect(SHARED_GLOBAL_INPUTS).not.toContain('{workspaceRoot}/.prettierrc.mjs')
    expect(SHARED_GLOBAL_INPUTS).not.toContain('{workspaceRoot}/package-lock.json')
  })
})

describe('generatorDefaults', () => {
  it("sets linter 'none' — the root config lints everything — and carries the testRunner", () => {
    // Not a regression: `none` stops a direct `nx g` from scaffolding a
    // per-project config that would compete with the workspace's single root
    // one. `@nx/eslint/plugin` still gives the project its `lint` target.
    const defaults = generatorDefaults({ testRunner: 'jest' }) as Record<
      string,
      { linter: string; unitTestRunner: string }
    >
    expect(defaults['@nx/js:library']).toEqual({ linter: 'none', unitTestRunner: 'jest' })
    expect(defaults['@nx/react:application']).toEqual({ linter: 'none', unitTestRunner: 'jest' })
  })
})

describe('mnciConfig', () => {
  it('persists the full resolved overlay options — what `add` and `upgrade` each read back a slice of', () => {
    const options = {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' } as const,
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github' as const,
      stack:         { testRunner: 'vitest' as const, linter: 'eslint' as const },
    }
    expect(mnciConfig(options)).toEqual({
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         { testRunner: 'vitest' },
    })
  })
})

describe('readMnciConfig', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-read-config-'))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('reads back exactly what applyOverlay persisted', () => {
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ $schema: 's', namedInputs: {} }))
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: '@org/source', private: true, devDependencies: { nx: '23.0.0' } }),
    )
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         DEFAULT_STACK,
    })

    expect(readMnciConfig(workspaceRoot)).toEqual({
      // workspaceName is persisted so `mnci upgrade` can name the
      // `<name>.code-workspace` it rewrites; without it, upgrade wrote a file
      // literally called `undefined.code-workspace`.
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         DEFAULT_STACK,
    })
  })

  it('returns an empty object for a workspace with no mnci block at all (predates persistence)', () => {
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ $schema: 's' }))

    expect(readMnciConfig(workspaceRoot)).toEqual({})
  })
})

describe('rootScripts', () => {
  it('uses nx lint, and `format` is eslint --fix — one tool, one command', () => {
    const scripts = rootScripts()

    expect(scripts.lint).toBe('nx run-many -t lint')
    expect(scripts.format).toBe('eslint . --fix --cache')
    // No `format:check`: `lint` already reports formatting as ordinary errors,
    // so a second script would run the same binary twice for no new coverage.
    expect(scripts['format:check']).toBeUndefined()
  })

  it('adds python:install chaining the same two guards CI runs (for local-dev convenience)', () => {
    const scripts = rootScripts()

    // Fixed dev toolchain (ruff/pytest/build/twine from requirements-dev.txt) ...
    expect(scripts['python:install']).toContain('-m pip install -r requirements-dev.txt')
    // ... then the workspace-wide editable install of every Python project.
    expect(scripts['python:install']).toContain('globSync(\'apps/*/pyproject.toml\')')
    expect(scripts['python:install']).toContain('globSync(\'python-packages/*/pyproject.toml\')')
    expect(scripts['python:install']).toContain('globSync(\'libs/*/pyproject.toml\')')
    // Chained (not parallel), toolchain install first.
    const toolchainIndex = scripts['python:install'].indexOf(
      '-m pip install -r requirements-dev.txt',
    )
    const workspaceIndex = scripts['python:install'].indexOf('globSync(\'apps/*/pyproject.toml\')')
    expect(toolchainIndex).toBeGreaterThan(-1)
    expect(workspaceIndex).toBeGreaterThan(toolchainIndex)
  })

  it('stamps python:install unconditionally (both guards already no-op with no Python projects)', () => {
    // This used to call rootScripts({ testRunner }) twice to prove the script was
    // stack-independent. rootScripts takes no parameters, so both calls were
    // identical and the test asserted the same thing twice — stack-independence
    // is now guaranteed by the signature rather than by assertion.
    expect(rootScripts()['python:install']).toBeDefined()
  })
})

describe('DOTNET_SDK_VERSION', () => {
  it('is a major.minor.x range, matching what actions/setup-dotnet and UseDotNet@2 expect', () => {
    // Unlike NODE_VERSION (a bare major — setup-node resolves majors on its
    // own), .NET's own install actions want the '.x' suffix explicit.
    expect(DOTNET_SDK_VERSION).toMatch(/^\d+\.\d+\.x$/)
  })

  it('pins an even (LTS) major, not an odd short-term-support one', () => {
    // .NET's own support policy: even-numbered majors are LTS, odd ones are
    // 18-month STS. Pinning CI/devcontainer provisioning to an STS release
    // would need a bump on a much tighter clock than mnci's other toolchain
    // pins.
    const major = Number(DOTNET_SDK_VERSION.split('.', 1)[0])
    expect(major % 2).toBe(0)
  })
})

describe('ensureEslintCacheIgnored', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-eslintcache-'))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('is a no-op when there is no .gitignore to append to', () => {
    ensureEslintCacheIgnored(workspaceRoot)

    expect(existsSync(join(workspaceRoot, '.gitignore'))).toBe(false)
  })

  it('adds a trailing newline and a blank-line separator before the new entry', () => {
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\nnode_modules')

    ensureEslintCacheIgnored(workspaceRoot)

    expect(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')).toBe(
      'dist\nnode_modules\n\n# Added by MoNecromanCI: `npm run format`/`lint` run `eslint --cache`.\n.eslintcache\n',
    )
  })

  it('recognises the entry with surrounding whitespace, not just an exact line', () => {
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\n  .eslintcache  \n')

    ensureEslintCacheIgnored(workspaceRoot)

    expect(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')).toBe('dist\n  .eslintcache  \n')
  })
})

describe('ensurePythonArtefactsIgnored', () => {
  let workspaceRoot: string

  const withPythonProject = (): void => {
    mkdirSync(join(workspaceRoot, 'python-packages/pylib'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'python-packages/pylib/pyproject.toml'), '[project]\n')
  }

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-pyignore-'))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('is a no-op when there is no .gitignore to append to', () => {
    withPythonProject()

    ensurePythonArtefactsIgnored(workspaceRoot)

    expect(existsSync(join(workspaceRoot, '.gitignore'))).toBe(false)
  })

  it('leaves a workspace with no Python project alone', () => {
    // A pure-JavaScript workspace has no business carrying ignores for a
    // language it does not use, and this is the whole difference from
    // `.eslintcache`, which every workspace produces.
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\nnode_modules\n')

    ensurePythonArtefactsIgnored(workspaceRoot)

    expect(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')).toBe('dist\nnode_modules\n')
  })

  it('adds the bytecode ignores when a Python project exists', () => {
    // `create-nx-workspace`'s template is a JavaScript template: `dist`, `tmp`,
    // `out-tsc`, `node_modules`, and not one line about any other language. So
    // running a generated Python project's own targets left two `__pycache__/`
    // directories for the first `git add -A` to commit — measured on a real
    // generated workspace, not inferred.
    withPythonProject()
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\nnode_modules')

    ensurePythonArtefactsIgnored(workspaceRoot)

    const gitignore = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')
    expect(gitignore.split('\n')).toContain('__pycache__/')
    expect(gitignore.split('\n')).toContain('*.py[cod]')
    // Same shape as the `.eslintcache` append: a blank-line separator, a comment
    // saying who added it and why, and a trailing newline.
    expect(gitignore).toBe(
      'dist\nnode_modules\n\n# Added by MoNecromanCI: Python bytecode. The tool caches (.mypy_cache,\n# .pytest_cache, .ruff_cache) write their own .gitignore; CPython does not.\n__pycache__/\n*.py[cod]\n',
    )
  })

  it('does not ignore the three tool caches, because they ignore themselves', () => {
    // Not an omission. mypy, pytest and ruff each write a `.gitignore`
    // containing `*` into their own cache directory; CPython does not, which is
    // why the bytecode is the part that leaked. Adding lines for the caches
    // would be three lines of noise claiming to fix something already fixed.
    withPythonProject()
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\n')

    ensurePythonArtefactsIgnored(workspaceRoot)

    const gitignore = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')
    for (const cache of ['.mypy_cache', '.pytest_cache', '.ruff_cache']) {
      expect(gitignore).not.toContain(cache + '/\n')
    }
    // And no `.venv`: mnci invokes the toolchain as `python3 -m <tool>` and
    // never creates one, so ignoring it would be a guess about how someone
    // works rather than a fact about what this generates.
    expect(gitignore).not.toContain('.venv')
  })

  it('is idempotent, so mnci upgrade can run on an already-fixed workspace', () => {
    withPythonProject()
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\n')

    ensurePythonArtefactsIgnored(workspaceRoot)
    const once = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')
    ensurePythonArtefactsIgnored(workspaceRoot)

    expect(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')).toBe(once)
  })

  it('adds only the lines that are missing, whitespace and all', () => {
    // A workspace that added one line by hand should get the other, not a
    // duplicate of the first.
    withPythonProject()
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\n  __pycache__/  \n')

    ensurePythonArtefactsIgnored(workspaceRoot)

    const lines = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8').split('\n')
    expect(lines.filter(line => line.trim() === '__pycache__/')).toHaveLength(1)
    expect(lines).toContain('*.py[cod]')
  })

  it('finds a Python project under apps/ and libs/ too', () => {
    // The same three roots every other Python-aware guard in this file scans.
    for (const root of ['apps/pysvc', 'libs/pycore']) {
      const fresh = mkdtempSync(join(tmpdir(), 'mnci-pyignore-root-'))
      mkdirSync(join(fresh, root), { recursive: true })
      writeFileSync(join(fresh, root, 'pyproject.toml'), '[project]\n')
      writeFileSync(join(fresh, '.gitignore'), 'dist\n')

      ensurePythonArtefactsIgnored(fresh)

      expect(readFileSync(join(fresh, '.gitignore'), 'utf8')).toContain('__pycache__/')
      rmSync(fresh, { recursive: true, force: true })
    }
  })
})

describe('applyOverlay', () => {
  let workspaceRoot: string

  const overlayWith = (stack: StackConfig): void =>
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack,
    })

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-overlay-'))
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ $schema: 's', namedInputs: {} }))
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: '@org/source', private: true, devDependencies: { nx: '23.0.0' } }),
    )
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('appends .eslintcache to an existing .gitignore create-nx-workspace wrote', () => {
    writeFileSync(
      join(workspaceRoot, '.gitignore'),
      ['# compiled output', 'dist', '', 'node_modules', ''].join('\n'),
    )

    overlayWith(DEFAULT_STACK)

    const gitignore = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')
    expect(gitignore.split('\n')).toContain('.eslintcache')
    // Nothing create-nx-workspace already wrote is disturbed.
    expect(gitignore).toContain('dist')
    expect(gitignore).toContain('node_modules')
  })

  it('does not duplicate the entry on a second mnci upgrade', () => {
    writeFileSync(join(workspaceRoot, '.gitignore'), 'dist\nnode_modules\n')

    overlayWith(DEFAULT_STACK)
    overlayWith(DEFAULT_STACK)

    const gitignore = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')
    expect(gitignore.match(/^\.eslintcache$/gm)).toHaveLength(1)
  })

  it('leaves a .gitignore that already ignores it untouched', () => {
    const original = 'dist\nnode_modules\n.eslintcache\n'
    writeFileSync(join(workspaceRoot, '.gitignore'), original)

    overlayWith(DEFAULT_STACK)

    expect(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')).toBe(original)
  })

  it('does not write a .gitignore that was never there (create-nx-workspace owns it)', () => {
    overlayWith(DEFAULT_STACK)

    expect(existsSync(join(workspaceRoot, '.gitignore'))).toBe(false)
  })

  it('writes the five overlay files and leaves the rest of nx.json intact', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(nxJson.$schema).toBe('s')
    expect(nxJson.release).toBeDefined()

    expect(existsSync(join(workspaceRoot, '.npmrc'))).toBe(true)
    expect(readFileSync(join(workspaceRoot, 'commitlint.config.mjs'), 'utf8')).toContain(
      '@commitlint/config-conventional',
    )
    expect(readFileSync(join(workspaceRoot, '.husky/commit-msg'), 'utf8')).toContain(
      'commitlint --edit',
    )
    const pipeline = readFileSync(join(workspaceRoot, 'azure-pipelines.yml'), 'utf8')
    expect(pipeline).toContain('  vmImage: ubuntu-latest')
    expect(pipeline).toContain('- group: Build')
  })

  it('writes only azure-pipelines.yml when ci: "azure" (the default)', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    expect(existsSync(join(workspaceRoot, 'azure-pipelines.yml'))).toBe(true)
    expect(existsSync(join(workspaceRoot, '.github/workflows/ci.yml'))).toBe(false)
  })

  it('writes only .github/workflows/ci.yml when ci: "github"', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         DEFAULT_STACK,
    })

    expect(existsSync(join(workspaceRoot, 'azure-pipelines.yml'))).toBe(false)
    const workflow = readFileSync(join(workspaceRoot, '.github/workflows/ci.yml'), 'utf8')
    expect(workflow).toContain('runs-on: ubuntu-latest')
    // Public npm: the CI must actually be able to authenticate a publish —
    // NODE_AUTH_TOKEN (matching .npmrc), not the Azure-Artifacts-only PAT.
    expect(workflow).toContain('NODE_AUTH_TOKEN')
    expect(workflow).not.toContain('secrets.PAT')
  })

  it('threads the registry kind through to azure-pipelines.yml too, when both providers are chosen for a public npm registry', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })

    const pipeline = readFileSync(join(workspaceRoot, 'azure-pipelines.yml'), 'utf8')
    expect(pipeline).toContain('NODE_AUTH_TOKEN: $(NPM_TOKEN)')
    expect(pipeline).not.toContain('PAT: $(PAT)')
  })

  it('writes both pipeline files when ci: "both"', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })

    expect(existsSync(join(workspaceRoot, 'azure-pipelines.yml'))).toBe(true)
    expect(existsSync(join(workspaceRoot, '.github/workflows/ci.yml'))).toBe(true)
  })

  it('never writes .github/dependabot.yml when ci: "azure" (the default) — Dependabot is GitHub-native', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    expect(existsSync(join(workspaceRoot, '.github/dependabot.yml'))).toBe(false)
  })

  it('writes .github/dependabot.yml alongside the workflow for ci: "github"', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         DEFAULT_STACK,
    })

    const dependabot = readFileSync(join(workspaceRoot, '.github/dependabot.yml'), 'utf8')
    const parsed = yaml.load(dependabot) as {
      updates: Array<{ 'package-ecosystem': string; 'directory'?: string; 'directories'?: string[] }>
    }
    // A fresh workspace has NO Python or Dart project, so pip and pub must be
    // absent. They used to be written unconditionally, on the belief that
    // "directories matching nothing is not an error for Dependabot". It is a
    // hard failure: this repo's own Dependabot history shows the pip job red on
    // every weekly run for over a month, beside a green npm job.
    expect(parsed.updates.map(update => update['package-ecosystem'])).toEqual([
      'npm',
      'github-actions',
    ])
  })

  it('groups the Nx packages into one Dependabot PR, since they are pinned to one version (#295)', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         DEFAULT_STACK,
    })

    const parsed = yaml.load(readFileSync(join(workspaceRoot, '.github/dependabot.yml'), 'utf8')) as {
      updates: Array<{ 'package-ecosystem': string; 'groups'?: Record<string, { patterns: string[] }> }>
    }

    expect(parsed.updates.find(update => update['package-ecosystem'] === 'npm')?.groups).toEqual({ nx: { patterns: ['nx', '@nx/*'] } })
  })

  it('adds the pip block once a Python project exists, and not before', () => {
    const options = {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' as const },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github' as const,
      stack:         DEFAULT_STACK,
    }
    const ecosystems = (): string[] => {
      const parsed = yaml.load(
        readFileSync(join(workspaceRoot, '.github/dependabot.yml'), 'utf8'),
      ) as { updates: Array<{ 'package-ecosystem': string }> }

      return parsed.updates.map(update => update['package-ecosystem'])
    }

    applyOverlay(workspaceRoot, options)
    expect(ecosystems()).not.toContain('pip')

    mkdirSync(join(workspaceRoot, 'python-packages/api'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'python-packages/api/pyproject.toml'), '[project]\n')
    applyOverlay(workspaceRoot, options)
    expect(ecosystems()).toContain('pip')
    expect(ecosystems()).not.toContain('pub')

    const parsed = yaml.load(
      readFileSync(join(workspaceRoot, '.github/dependabot.yml'), 'utf8'),
    ) as { updates: Array<{ 'package-ecosystem': string; 'directories'?: string[] }> }
    // Globs are KEPT for an ecosystem that is emitted, so a second Python
    // project needs no rewrite. Only whether the block appears at all changed.
    expect(
      parsed.updates.find(update => update['package-ecosystem'] === 'pip')?.directories,
    ).toEqual(['/apps/*', '/python-packages/*', '/libs/*'])
  })

  it('adds the pub block once a Dart project exists', () => {
    const options = {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' as const },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github' as const,
      stack:         DEFAULT_STACK,
    }
    mkdirSync(join(workspaceRoot, 'apps/mobile'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/mobile/pubspec.yaml'), 'name: mobile\n')
    applyOverlay(workspaceRoot, options)

    const parsed = yaml.load(
      readFileSync(join(workspaceRoot, '.github/dependabot.yml'), 'utf8'),
    ) as { updates: Array<{ 'package-ecosystem': string; 'directories'?: string[] }> }
    expect(parsed.updates.map(update => update['package-ecosystem'])).toEqual([
      'npm',
      'github-actions',
      'pub',
    ])
    expect(
      parsed.updates.find(update => update['package-ecosystem'] === 'pub')?.directories,
    ).toEqual(['/apps/*', '/packages/*', '/libs/*'])
  })

  it('writes .github/dependabot.yml for ci: "both" too', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })

    expect(existsSync(join(workspaceRoot, '.github/dependabot.yml'))).toBe(true)
  })

  it('turns on sync.applyChanges so a stale TS project reference is fixed automatically, not just prompted', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as {
      sync?: { applyChanges?: boolean }
    }
    expect(nxJson.sync?.applyChanges).toBe(true)
  })

  it("writes the stack as nx.json generator defaults (for a user's own direct `nx g`)", () => {
    overlayWith({ testRunner: 'vitest' })

    const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as {
      generators: Record<string, { linter: string; unitTestRunner: string }>
    }
    expect(nxJson.generators['@nx/js:library']).toEqual({
      linter:         'none',
      unitTestRunner: 'vitest',
    })
  })

  it('writes mnci.stack — the single source of truth `add` reads back, not the generator defaults', () => {
    overlayWith({ testRunner: 'vitest' })

    const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as {
      mnci: { stack: { testRunner: string } }
    }
    expect(nxJson.mnci.stack).toEqual({ testRunner: 'vitest' })
  })

  it('writes the shared global inputs into nx.json, so an affected-scoped PR is not blind to the root configs', () => {
    // The unit tests above cover the merge; this covers the wiring. Without it
    // `withSharedGlobals` could be correct and simply never called — which is
    // exactly how the root eslint config went unowned for so long.
    overlayWith(DEFAULT_STACK)

    const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as {
      namedInputs: { sharedGlobals: string[] }
    }
    expect(nxJson.namedInputs.sharedGlobals).toEqual([...SHARED_GLOBAL_INPUTS])
  })

  it('writes the jsx-a11y peer override, without which npm install fails on ESLint 10', () => {
    // `eslint-plugin-jsx-a11y@6.10.2` peers at `^3 … ^9`, so npm ERESOLVEs
    // against ESLint 10. The cap is stale, not real — measured: with this
    // override the plugin installs and its rules still fire. npm only honours
    // `overrides` in the ROOT manifest, which is why the config package cannot
    // carry its own fix and mnci has to write this.
    overlayWith(DEFAULT_STACK)

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      overrides:       Record<string, unknown>
      devDependencies: Record<string, string>
    }

    expect(manifest.overrides['eslint-plugin-jsx-a11y']).toEqual({ eslint: '$eslint' })
    // `$eslint` is what keeps the override from pinning a version of its own, so
    // it has to resolve against a declared `eslint` — assert both halves.
    expect(manifest.devDependencies.eslint).toBe(ESLINT_VERSION)
    expect(ESLINT_VERSION.startsWith('^10.')).toBe(true)
  })

  it('writes an @mnci/eslint-config range that floats to future 0.x releases via npm update alone', () => {
    // Reported bug, reproduced by construction: a real generated workspace was
    // still declaring `^0.1.0` after 20+ published releases. `^` on a pre-1.0
    // package is minor-locked - `^0.1.0` means `>=0.1.0 <0.2.0` - so `npm
    // update` could never carry it past 0.1.x, no matter how long the workspace
    // went between `mnci upgrade` runs. Verified with the real `semver`
    // resolver (the same one npm itself uses), not a hand-rolled comparison.
    //
    // Deliberately NOT pinned to today's published version: hardcoding "the
    // latest is 0.3.6" would go stale the moment 0.3.7 ships, which is exactly
    // the class of bug this test exists to catch. Instead it asserts the
    // PROPERTY that must hold no matter what version ships next - an
    // arbitrarily far-future 0.x still satisfies the range - so the test
    // cannot rot the way the code it is guarding against did.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- no @types/semver; see below
    const semver = require('semver') as { satisfies: (version: string, range: string) => boolean }

    expect(semver.satisfies('0.1.0', ESLINT_CONFIG_VERSION)).toBe(true)
    // Stands in for "whatever the latest 0.x is by the time this test runs" -
    // a number this high can never accidentally become real, so it only passes
    // if the range genuinely has no minor ceiling.
    expect(semver.satisfies('0.999.999', ESLINT_CONFIG_VERSION)).toBe(true)
    // Below the floor: an ancient release must still be excluded.
    expect(semver.satisfies('0.0.9', ESLINT_CONFIG_VERSION)).toBe(false)
    // Crossing into a stable 1.0 is an intentional decision (bumping this
    // constant), not something `npm update` should do on its own.
    expect(semver.satisfies('1.0.0', ESLINT_CONFIG_VERSION)).toBe(false)

    // The structural guard against ever reintroducing the exact bug: any
    // range of the form `^0.x` is minor-locked under npm's semver rules, full
    // stop, regardless of which 0.x this constant happens to read today.
    expect(ESLINT_CONFIG_VERSION).not.toMatch(/^\^0\./)

    overlayWith(DEFAULT_STACK)
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(manifest.devDependencies['@mnci/eslint-config']).toBe(ESLINT_CONFIG_VERSION)
  })

  it('mnci upgrade replaces a stale caret range instead of leaving a workspace stuck on it', () => {
    // The second half of the bug: even fixing the constant does nothing for a
    // workspace that already has the old `^0.1.0` written into its manifest,
    // unless `mnci upgrade` actually overwrites it rather than deferring to
    // what is already there.
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({
        name:            'x',
        devDependencies: { '@mnci/eslint-config': '^0.1.0' },
      }),
    )

    overlayWith(DEFAULT_STACK)

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(manifest.devDependencies['@mnci/eslint-config']).toBe(ESLINT_CONFIG_VERSION)
    expect(manifest.devDependencies['@mnci/eslint-config']).not.toBe('^0.1.0')
  })

  it('declares @mnci/cli, which the pipeline calls with npx mnci ci, across the major it was written for', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- no @types/semver; see the eslint-config test above
    const semver = require('semver') as { satisfies: (version: string, range: string) => boolean }

    expect(semver.satisfies('4.0.0', CLI_VERSION)).toBe(true)
    expect(semver.satisfies('4.99.0', CLI_VERSION)).toBe(true)
    // A new major is a deliberate edit of the constant, never something npm update does by itself.
    expect(semver.satisfies('5.0.0', CLI_VERSION)).toBe(false)
    expect(semver.satisfies('3.9.0', CLI_VERSION)).toBe(false)

    overlayWith(DEFAULT_STACK)
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(manifest.devDependencies['@mnci/cli']).toBe(CLI_VERSION)
  })

  it('points @mnci/cli at a local build when MNCI_CLI_SPEC says so, as the e2e needs', () => {
    process.env.MNCI_CLI_SPEC = '/tmp/mnci-cli.tgz'
    try {
      overlayWith(DEFAULT_STACK)
    } finally {
      delete process.env.MNCI_CLI_SPEC
    }
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }

    expect(manifest.devDependencies['@mnci/cli']).toBe('/tmp/mnci-cli.tgz')
  })

  it('mnci upgrade puts @mnci/cli into a workspace created before the pipeline called it', () => {
    writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { nx: '23.0.0' } }))

    overlayWith(DEFAULT_STACK)

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(manifest.devDependencies['@mnci/cli']).toBe(CLI_VERSION)
    expect(manifest.devDependencies.nx).toBe('23.0.0')
  })

  it('keeps a key the workspace added inside an override mnci also writes, and refreshes the ones mnci owns (#421)', () => {
    // Found upgrading a real workspace: its `overrides.nx` carried an extra `undici` pin. A spread replaced the whole
    // `nx` object with mnci's, so the pin vanished and a high advisory came back.
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'x', overrides: { nx: { 'brace-expansion': '^5.0.1', 'undici': '^7.29.1' } } }),
    )
    overlayWith(DEFAULT_STACK)

    const { overrides } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      overrides: Record<string, Record<string, string>>
    }

    expect(overrides.nx.undici).toBe('^7.29.1')
    // mnci's own pins win on conflict, so the upgrade still brings them up to date.
    expect(overrides.nx['brace-expansion']).toBe('^5.0.9')
    expect(overrides.nx['smol-toml']).toBe('^1.7.1')
    expect(overrides.nx.axios).toBe('^1.20.0')
  })

  it("merges overrides rather than replacing a workspace's own", () => {
    // A user's `overrides` block is theirs; `mnci upgrade` must not delete it.
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'x', overrides: { 'left-pad': '1.0.0' } }),
    )
    overlayWith(DEFAULT_STACK)

    const { overrides } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      overrides: Record<string, unknown>
    }

    expect(overrides['left-pad']).toBe('1.0.0')
    expect(overrides).toMatchObject(ESLINT_PEER_OVERRIDES)

    // Named explicitly, not just via the constant: this one is a SECURITY fix,
    // and a generated workspace shipped six high advisories without it. The audit
    // step found it the first time it ran inside a generated workspace —
    // `brace-expansion` carries a high advisory that `nx`, `@nx/js`,
    // `@nx/eslint`, `@nx/eslint-plugin` and `@nx/workspace` all inherit, and npm
    // reports the fix as semver-major, so `npm audit fix` would try to bump `nx`
    // itself. This repo had carried the same override for its own tree all along.
    for (const parent of ['@nx/js', '@nx/eslint', '@nx/eslint-plugin', '@nx/workspace']) {
      expect(overrides[parent]).toEqual({ 'brace-expansion': '^5.0.9' })
    }
    // `nx` itself also carries `smol-toml` — a second, unrelated advisory
    // (GHSA-7w5x-hrqm-74c2) that is a dependency of `nx` alone rather than each
    // `@nx/*` package independently, so ONE entry (not five) is the real fix. A
    // fresh generated workspace's own audit step caught it never having shipped
    // here, exactly the same dogfooding drift as `brace-expansion` above.
    // And `axios` (twelve high advisories below 1.20.0, reached through `nx`
    // alone): a fresh workspace on nx 23.2 failed its own audit gate without it.
    expect(overrides.nx).toEqual({ 'brace-expansion': '^5.0.9', 'smol-toml': '^1.7.1', 'axios': '^1.20.0' })
    // NOT top-level: a tree with minimatch@3 legitimately carries
    // brace-expansion@1.x, and forcing that to v5 breaks it.
    expect(overrides['brace-expansion']).toBeUndefined()
    expect(overrides['smol-toml']).toBeUndefined()
    expect(overrides.axios).toBeUndefined()
  })

  it('gives the root project a lint target, since nothing else lints root-level files', () => {
    // `nx run-many -t lint` only runs targets that belong to a project, and every
    // other `lint` target runs `eslint .` inside its own project — so .github/
    // workflows, the pipeline YAML, root JSON/Markdown and the root config files
    // were linted by nothing at all.
    overlayWith(DEFAULT_STACK)

    const { nx } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      nx: { includedScripts: unknown[]; targets: Record<string, unknown> }
    }

    expect(nx.targets.lint).toEqual(ROOT_LINT_TARGET)
    // Load-bearing: the root scripts are the `nx run-many` aggregators, so letting
    // Nx infer targets from them would make `lint` invoke `nx run-many -t lint`.
    expect(nx.includedScripts).toEqual([])
    // The ignore patterns must be CLI flags — in flat config, `ignores` are
    // relative to the config file, which every project's own lint resolves too.
    const { command } = ROOT_LINT_TARGET.options
    expect(command).toContain('--ignore-pattern "packages/**"')
    expect(command).toContain('--ignore-pattern "python-packages/**"')
  })

  it("keeps a workspace's own root targets when adding the lint one", () => {
    // Deliberately NOT `local-registry`, which this overlay now removes on
    // purpose - see the verdaccio test below. A target mnci has an opinion
    // about proves nothing here; the claim is that a target it has never heard
    // of survives.
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'x', nx: { targets: { 'ship-it': { executor: 'x' } } } }),
    )
    overlayWith(DEFAULT_STACK)

    const { nx } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      nx: { targets: Record<string, unknown> }
    }

    expect(nx.targets['ship-it']).toEqual({ executor: 'x' })
    expect(nx.targets.lint).toEqual(ROOT_LINT_TARGET)
  })

  it('gives every tool one version, shared by the devcontainer and both CI providers, and installs none at latest (#241)', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })
    const devcontainer = readFileSync(join(workspaceRoot, '.devcontainer/devcontainer.json'), 'utf8')
    const github = readFileSync(join(workspaceRoot, '.github/workflows/ci.yml'), 'utf8')
    const azure = readFileSync(join(workspaceRoot, 'azure-pipelines.yml'), 'utf8')
    const container = JSON.parse(devcontainer) as { image: string, features: Record<string, { version?: string }> }

    // Node: the container image's major, and both providers' setup step.
    expect(container.image).toContain(`typescript-node:${NODE_VERSION}-`)
    expect(github).toContain(`node-version: ${NODE_VERSION}`)
    expect(azure).toContain(`version: ${NODE_VERSION}.x`)
    // .NET: the feature takes X.Y, the providers X.Y.x, from one constant.
    expect(`${container.features['ghcr.io/devcontainers/features/dotnet:2'].version}.x`).toBe(DOTNET_SDK_VERSION)
    expect(github).toContain(`dotnet-version: ${DOTNET_SDK_VERSION}`)
    expect(azure).toContain(`version: ${DOTNET_SDK_VERSION}`)
    // golangci-lint and Flutter are installed by `mnci ci setup`, which reads the one constant, in the
    // container and in both providers; the container's Go feature names the same linter version.
    expect(container.features['ghcr.io/devcontainers/features/go:1']).toEqual({ version: GO_VERSION, golangciLintVersion: GOLANGCI_LINT_VERSION })
    for (const file of [github, azure]) {
      expect(file).toContain('npx mnci ci setup')
    }
    expect(devcontainer).toContain('npx mnci ci setup')
    // And nothing mnci generates asks for a tool at latest.
    for (const [name, text] of [['devcontainer', devcontainer], ['github', github], ['azure', azure]]) {
      expect({ file: name, latest: /@latest|"latest"|: latest\b|version:\s*'latest'/.test(text) }).toEqual({ file: name, latest: false })
    }
  })

  it('keeps an ESLint entry point that imports the package directly, and says how to use the generated file (#422)', () => {
    const config = "import mnci from '@mnci/eslint-config'\nexport default [...mnci({ workspaceRoot: import.meta.dirname, verticalSlices: [] })]\n"
    writeFileSync(join(workspaceRoot, 'eslint.config.mjs'), config)
    const progress: string[] = []

    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    }, (line) => { progress.push(line) })

    expect(readFileSync(join(workspaceRoot, 'eslint.config.mjs'), 'utf8')).toBe(config)
    const text = progress.join(' | ')

    expect(text).toContain('eslint.config.mjs — kept as it is')
    expect(text).toContain('imports @mnci/eslint-config directly, which still works')
    expect(text).toContain("change that import's specifier to './eslint.config.mnci.mjs'")
  })

  it('says nothing extra for an entry point that already imports the generated file', () => {
    writeFileSync(join(workspaceRoot, 'eslint.config.mjs'), "import mnci from './eslint.config.mnci.mjs'\nexport default [...mnci()]\n")
    const progress: string[] = []

    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    }, (line) => { progress.push(line) })

    expect(progress.join(' | ')).not.toContain('directly')
  })

  it('writes .devcontainer/devcontainer.json, so a local environment can match CI', () => {
    overlayWith(DEFAULT_STACK)

    const written = readFileSync(join(workspaceRoot, '.devcontainer/devcontainer.json'), 'utf8')

    expect(JSON.parse(written).name).toBe('demo')
    expect(written).toBe(devcontainerJson('demo'))
  })

  it('writes the whole mnci block — workspaceName/scope/registry/agent/variableGroup/ci — so `mnci upgrade` can reconstruct the exact options a later run resolved', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      {
        kind:          'azure-artifacts',
        organization:  'org',
        project:       'proj',
        artifactsFeed: 'feed',
      },
      agent:         'windows-latest',
      variableGroup: 'CiSecrets',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })

    const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')) as {
      mnci: Record<string, unknown>
    }
    expect(nxJson.mnci).toEqual({
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      {
        kind:          'azure-artifacts',
        organization:  'org',
        project:       'proj',
        artifactsFeed: 'feed',
      },
      agent:         'windows-latest',
      variableGroup: 'CiSecrets',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })
  })

  it('writes a root eslint config that delegates to @mnci/eslint-config', () => {
    overlayWith(DEFAULT_STACK)

    // ESLint config is an mnci-owned file as of this change. Before it, a
    // generated workspace kept create-nx-workspace's bare @nx/eslint-plugin
    // default while the rich rules lived only in mnci's own repo.
    //
    // It is now TWO files, and the rules are in the one mnci owns.
    const rules = readFileSync(join(workspaceRoot, 'eslint.config.mnci.mjs'), 'utf8')
    expect(rules).toContain("import mnci from '@mnci/eslint-config'")
    // workspaceRoot is what enables the @nx/dependency-checks block, which has
    // to scan for private manifests.
    expect(rules).toContain('workspaceRoot: import.meta.dirname')

    const devDependencies = (
      JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>
      }
    ).devDependencies
    expect(devDependencies['@mnci/eslint-config']).toBeDefined()
  })

  it('makes the entry point the file the workspace owns, not the one with the rules', () => {
    overlayWith(DEFAULT_STACK)

    // ESLint loads eslint.config.mjs, so that has to be the file a workspace
    // may edit — otherwise the tool's own default filename is the one mnci
    // overwrites, which is exactly how overrides used to be deleted.
    const rules = readFileSync(join(workspaceRoot, 'eslint.config.mnci.mjs'), 'utf8')
    const entryPoint = readFileSync(join(workspaceRoot, 'eslint.config.mjs'), 'utf8')
    expect(entryPoint).toContain("import mnci from './eslint.config.mnci.mjs'")
    expect(entryPoint).toContain('...mnci()')
    // A FUNCTION, so the workspace can pass options it would otherwise have
    // nowhere to put — mnci's own repo passes `verticalSlices`.
    // A named function declaration, exported inline — both shapes are forced
    // by rules this very file turns on. An anonymous arrow trips
    // `unicorn/no-anonymous-default-export`, and hoisting it above the export
    // trips `unicorn/default-export-style`. Either one fails a generated
    // workspace's own lint on its first run, which is how dogfooding this
    // repo's config caught them.
    expect(rules).toContain('export default function mnciConfig (options = {}) {')
    // And it must NOT carry the rules itself, or an upgrade would have to
    // rewrite it to change one.
    expect(entryPoint).not.toContain("'@mnci/eslint-config'")
  })

  it('never rewrites an eslint config the workspace has edited', () => {
    overlayWith(DEFAULT_STACK)

    // The bug this whole split exists for. `eslint.config.mjs` used to be
    // rewritten wholesale on every upgrade, so a block appended in the way the
    // file's own comment described was deleted without a word — and `upgrade`
    // then tells the user to run `npm run format`, which rewrites every file in
    // the repository against the rules that just changed.
    const path = join(workspaceRoot, 'eslint.config.mjs')
    const edited = `${readFileSync(path, 'utf8')}
// local/keep-me
`
    writeFileSync(path, edited)

    overlayWith(DEFAULT_STACK)

    expect(readFileSync(path, 'utf8')).toBe(edited)
  })

  it('moves an untouched old-layout config onto the split', () => {
    overlayWith(DEFAULT_STACK)

    // A workspace generated before the split has a single fat eslint.config.mjs
    // that imports @mnci/eslint-config directly. When it provably holds nothing
    // of the user's, replacing it costs only comments mnci wrote itself — so
    // upgrade crosses it over rather than leaving it behind forever.
    const path = join(workspaceRoot, 'eslint.config.mjs')
    writeFileSync(
      path,
      [
        '// WHAT IS IN HERE. Each line is one config block.',
        "import mnci from '@mnci/eslint-config'",
        '',
        '// TO OVERRIDE a rule, append a block AFTER the spread.',
        'export default mnci({ workspaceRoot: import.meta.dirname })',
        '',
      ].join('\n'),
    )

    overlayWith(DEFAULT_STACK)

    expect(readFileSync(path, 'utf8')).toContain("import mnci from './eslint.config.mnci.mjs'")
  })

  it('explains what is in the config, and how to override it', () => {
    overlayWith(DEFAULT_STACK)
    const rules = readFileSync(join(workspaceRoot, 'eslint.config.mnci.mjs'), 'utf8')
    const entryPoint = readFileSync(join(workspaceRoot, 'eslint.config.mjs'), 'utf8')

    // The cost of moving the rules into a package: a three-line config gives no
    // hint that twenty tools are behind it. The comment is what buys that back,
    // so it is part of the deliverable rather than decoration.
    expect(rules).toContain('npx eslint --inspect-config')
    // The override recipe belongs with the file a user may actually edit.
    expect(entryPoint).toContain("name: 'local/")
    // Each file says which of the two it is, because getting that wrong is the
    // one mistake that loses work.
    expect(rules).toContain('Every `mnci upgrade` overwrites this file')
    expect(entryPoint).toContain('This file is YOURS')
    // The one thing that cannot work must be stated where someone would try it,
    // not only in a README they have not opened — and what that is has CHANGED.
    // It used to be `space-before-function-paren`, unreachable while Prettier
    // rewrote `f (a)` back to `f(a)` on every run. That rule is now ON: it is
    // Standard's signature rule and nothing contradicts it any more.
    //
    // What replaces it is the inverse warning: do not add a formatter. Whichever
    // one is chosen disagrees with `mnci/standard`, and because a formatter runs
    // on save it wins silently — leaving `lint` to fail on files the user never
    // edited by hand.
    expect(rules).toContain('FORMATTING IS LINTING HERE')
    expect(rules).toContain('There is no Prettier, no oxfmt')
    expect(rules).toContain('Installing a Prettier or oxfmt extension is')
  })

  it('names blocks in the inventory that the real config actually has', () => {
    // A stale inventory is worse than no inventory: it sends the reader to a
    // block that does not exist, and nothing about generating a workspace would
    // notice. So the comment is checked against the real thing in BOTH
    // directions — a renamed block fails, and a new block nobody documented
    // fails too.
    //
    // A subprocess because @mnci/eslint-config is ESM and this spec runs as CJS
    // under ts-jest; `import`ing it here does not parse. The workspace symlink in
    // node_modules is what makes the bare specifier resolve.
    const script = `
      const mnci = (await import('@mnci/eslint-config')).default
      const blocks = mnci({ workspaceRoot: process.cwd() })
      process.stdout.write(JSON.stringify(blocks.map(block => block.name ?? null)))
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd:      join(__dirname, '..', '..', '..', '..'),
      encoding: 'utf8',
    })
    const stdout = result.stdout?.trim()
    if (!stdout?.startsWith('[')) {
      throw new Error(`could not resolve @mnci/eslint-config.\nstderr: ${result.stderr}`)
    }
    const actual = (JSON.parse(stdout) as (string | null)[]).filter(
      (name): name is string => name !== null,
    )
    expect(actual.length).toBeGreaterThan(20)

    // The inventory documents mnci's own blocks; `typescript-eslint/*` is
    // upstream's and is listed with a wildcard rather than enumerated.
    const documented = ESLINT_BLOCK_INVENTORY.match(/\bmnci\/[\w/*,-]+/g) ?? []
    const own = actual.filter(name => name.startsWith('mnci/'))

    // Multi-block presets are documented as `mnci/yaml/recommended*`, since how
    // many blocks upstream splits them into is not a user-facing fact.
    const covers = (name: string): boolean =>
      documented.some(entry =>
        entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : entry === name,
      )
    expect(own.filter(name => !covers(name))).toEqual([])

    // And nothing documented that no longer exists. `mnci/json, /jsonc, /json5`
    // is one line for three blocks, so the trailing comma is stripped and the
    // `/jsonc` shorthand is expanded against the family it belongs to.
    const stale = documented
      .map(entry => entry.replace(/,$/, ''))
      .filter(entry => !entry.endsWith('*'))
      .filter(entry => !own.includes(entry))
    expect(stale).toEqual([])
  })

  it('points `format` at eslint --fix, and ships no second format script', () => {
    // One tool means one command. `format:check` is deliberately absent: `lint`
    // already reports formatting as ordinary errors, so a second script would
    // run the same binary twice for no extra coverage.
    overlayWith({ testRunner: 'jest' })
    const { scripts } = JSON.parse(
      readFileSync(join(workspaceRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }

    expect(scripts.format).toBe('eslint . --fix --cache')
    expect(scripts['format:check']).toBeUndefined()
  })

  it('recommends the ESLint extension and NO formatter extension', () => {
    // The absence is the assertion. mnci recommended `esbenp.prettier-vscode`
    // for as long as Prettier owned formatting — and kept recommending it after
    // ESLint took over, which made mnci the thing that installed its own hazard.
    //
    // That extension needs no config file to act: with none present it formats
    // against Prettier's own defaults, semicolons and double quotes, the exact
    // inverse of Standard. Because it runs on save, the damage lands AFTER every
    // gate, so `lint` stays green until someone next looks. Recommending it
    // while `RETIRED_FORMATTER_FILES` deletes its config was the two halves of
    // one decision contradicting each other.
    const workspace = vscodeWorkspace('demo')
    expect(workspace).toContain('dbaeumer.vscode-eslint')
    expect(workspace).not.toContain('esbenp.prettier-vscode')
    expect(workspace).not.toContain('oxc.oxc-vscode')
  })

  it('recommends no retired formatter extension in the devcontainer either', () => {
    // The workspace file and the devcontainer read the same constant, so this
    // cannot diverge today — but the two lists HAVE been separate before, and a
    // container that silently installs a formatter is the harder half to notice,
    // since nobody opens it expecting to audit its extensions.
    const container = devcontainerJson('demo')
    expect(container).toContain('dbaeumer.vscode-eslint')
    expect(container).not.toContain('esbenp.prettier-vscode')
    expect(container).not.toContain('oxc.oxc-vscode')
  })

  it('points editor.defaultFormatter at ESLint, which is the formatter', () => {
    // Getting this wrong is silent and constant: format-on-save would invoke a
    // formatter the workspace does not configure, reformatting every file the
    // moment it is touched.
    expect(vscodeWorkspace('demo')).toContain(
      '"editor.defaultFormatter": "dbaeumer.vscode-eslint"',
    )
    expect(vscodeWorkspace('demo')).toContain(
      '"editor.defaultFormatter": "dbaeumer.vscode-eslint"',
    )
  })

  it('pins the formatter for EVERY language, not just the global default', () => {
    // The bug this fixes, reported from a real workspace: `.ts` files were not
    // formatted on save while `.json`/`.jsonc`/`.yaml` were — the three that had
    // explicit entries. VS Code resolves a language-specific setting ahead of a
    // general one, and does so BEFORE scope, so a `[typescript]` block in the
    // user's own settings outranks this file's global `editor.defaultFormatter`.
    // Nothing reports it: Prettier is installed, the config resolves, and
    // `format:check` still finds the unformatted files.
    const settings = JSON.parse(vscodeWorkspace('demo')).settings as Record<
      string,
      { 'editor.defaultFormatter'?: string }
    >
    for (const language of FORMATTED_LANGUAGES) {
      expect(settings[`[${language}]`]).toEqual({
        'editor.defaultFormatter': 'dbaeumer.vscode-eslint',
      })
    }
  })

  it('covers the languages that actually matter, TypeScript and HTML included', () => {
    // Asserted by name rather than only through the loop above, because the loop
    // would still pass if someone shortened FORMATTED_LANGUAGES back to the three
    // it started as — which is exactly how the reported bug existed. `html` is
    // here because it was missing for the same reason `typescript` was: the list
    // claimed to be "everything the formatter handles" and nobody checked it
    // against the binaries.
    for (const language of [
      'typescript',
      'typescriptreact',
      'javascript',
      'javascriptreact',
      'html',
    ]) {
      expect(FORMATTED_LANGUAGES).toContain(language)
    }
  })

  it('includes toml, which ESLint parses and no formatter here could', () => {
    // The entry the e2e asserted and the constant never got — a mismatch that
    // only a Windows nightly reported, and only after the oxlint mode (whose
    // `OXFMT_ONLY_LANGUAGES` used to carry it) was deleted.
    //
    // Measured, because the name of this constant overstates what it buys: a
    // real `eslint --fix` leaves a badly-laid-out `.toml` BYTE-IDENTICAL — the
    // TOML block is `flat/base`, parser only — while a malformed one reports
    // `Parsing error`. So the entry gets editor-side parse errors on a broken
    // `pyproject.toml`, and pins format-on-save to a no-op rather than to
    // whichever TOML formatter the user happens to have installed.
    expect(FORMATTED_LANGUAGES).toContain('toml')
  })

  it('recommends the same extensions in the devcontainer as in the workspace file', () => {
    // Shared for this reason: opening the workspace in a container must suggest
    // the same toolset as opening it directly. Asserted for BOTH rather than for
    // the constant alone — when these were two per-linter lists, the split was
    // exactly where they drifted.
    const container = JSON.parse(devcontainerJson('demo')) as {
      customizations: { vscode: { extensions: string[] } }
    }
    const workspace = JSON.parse(vscodeWorkspace('demo')) as {
      extensions: { recommendations: string[] }
    }

    expect(container.customizations.vscode.extensions).toEqual([...VSCODE_RECOMMENDED_EXTENSIONS])
    expect(workspace.extensions.recommendations).toEqual([...VSCODE_RECOMMENDED_EXTENSIONS])
  })

  it('exposes the four verify targets in Run and Debug, not only as tasks', () => {
    // A `tasks` entry is reachable only through Terminal -> Run Task. The Run and
    // Debug dropdown reads `launch`, so a workspace with tasks alone offers nothing
    // there — which is exactly what every generated workspace used to do.
    const workspace = JSON.parse(vscodeWorkspace('demo')) as {
      launch: { version: string; configurations: Record<string, unknown>[] }
    }

    expect(workspace.launch.configurations.map((c) => c.name)).toEqual([
      'mnci: build',
      'mnci: test',
      'mnci: lint',
      'mnci: typecheck',
    ])
  })

  it('drives npm scripts rather than a path into node_modules', () => {
    // Pointing `program` at node_modules/nx/bin/nx.js would be wrong twice over: Nx
    // ships its bin at dist/bin/nx.js, and that path is version-dependent. Driving
    // the root script instead tracks ROOT_SCRIPTS for free.
    const workspace = JSON.parse(vscodeWorkspace('demo')) as {
      launch: { configurations: Record<string, unknown>[] }
    }

    for (const configuration of workspace.launch.configurations) {
      expect(configuration.program).toBeUndefined()
      expect(configuration.command).toMatch(/^npm run /)
    }
    // Every script it launches must actually exist in the generated manifest.
    const scripts = Object.keys(rootScripts())
    for (const target of LAUNCH_CONFIGURATIONS) expect(scripts).toContain(target)
  })

  it('uses node-terminal, so a breakpoint in an nx-spawned child can bind', () => {
    // nx run-many executes every target in a CHILD process. A plain `node` launch
    // attaches to the Nx parent alone, so a breakpoint inside a spec never binds;
    // node-terminal runs in VS Code's JS Debug Terminal, which instruments children
    // as they spawn. This is the whole reason for the type, so it is pinned.
    const workspace = JSON.parse(vscodeWorkspace('demo')) as {
      launch: { configurations: Record<string, unknown>[] }
    }

    for (const configuration of workspace.launch.configurations) {
      expect(configuration.type).toBe('node-terminal')
    }
  })

  it('scopes cwd by folder NAME, which a second folder would otherwise break', () => {
    // A bare ${workspaceFolder} is ambiguous in a multi-root workspace and VS Code
    // refuses to resolve it. The generated file has one folder today, but a user
    // adding a second must not silently break every launch config.
    const workspace = JSON.parse(vscodeWorkspace('acme')) as {
      launch: { configurations: Record<string, unknown>[] }
    }

    for (const configuration of workspace.launch.configurations) {
      expect(configuration.cwd).toBe('${workspaceFolder:acme}')
    }
  })

  it('keeps settings mnci has no opinion about, and wins on the ones it does', () => {
    // Settings used to be replaced wholesale, which deleted everything a workspace
    // had added for itself. Measured on this repo's own file: an upgrade would have
    // destroyed a 1,179-entry cSpell.words dictionary that lives nowhere else.
    const workspace = JSON.parse(
      vscodeWorkspace('demo', undefined, undefined, {
        'cSpell.words':            ['mnci', 'monecromanci'],
        'editor.rulers':           [100],
        // A key mnci DOES own: its value must not survive.
        'editor.defaultFormatter': 'someone.else',
      }),
    ) as { settings: Record<string, unknown> }

    expect(workspace.settings['cSpell.words']).toEqual(['mnci', 'monecromanci'])
    expect(workspace.settings['editor.rulers']).toEqual([100])
    expect(workspace.settings['editor.defaultFormatter']).not.toBe('someone.else')
    // The mnci opinion still lands in full.
    for (const key of Object.keys(vscodeSettings())) {
      // Keys here contain literal dots, so toHaveProperty would read them as paths.
      expect(Object.keys(workspace.settings)).toContain(key)
    }
  })

  it('keeps a hand-written launch config across an upgrade, replacing only its own', () => {
    // Additive like nx.json sharedGlobals. Tasks are carried through wholesale
    // because `mnci add` writes them; launch entries are overlay-owned, so only the
    // `mnci: ` ones may be replaced.
    const mine = { type: 'node', request: 'launch', name: 'debug my thing' }
    const workspace = JSON.parse(
      vscodeWorkspace('demo', undefined, {
        version:        '0.2.0',
        configurations: [{ name: 'mnci: build', stale: true }, mine],
      }),
    ) as { launch: { configurations: Record<string, unknown>[] } }

    expect(workspace.launch.configurations).toContainEqual(mine)
    // The stale mnci-owned entry is replaced, not duplicated or preserved.
    const builds = workspace.launch.configurations.filter((c) => c.name === 'mnci: build')
    expect(builds).toHaveLength(1)
    expect(builds[0].stale).toBeUndefined()
  })

  it('merges launch configs by exact name, so a per-project entry mnci add wrote survives an upgrade (#230)', () => {
    // The old prefix match deleted every `mnci: ` entry, which is exactly what the per-project ones are called.
    const perProject = { type: 'node-terminal', request: 'launch', name: 'mnci: web start', command: 'npm run web:start' }
    const workspace = JSON.parse(
      vscodeWorkspace('demo', undefined, {
        version:        '0.2.0',
        configurations: [perProject, { name: 'mnci: lint', stale: true }],
      }),
    ) as { launch: { configurations: Record<string, unknown>[] } }

    expect(workspace.launch.configurations).toContainEqual(perProject)
    expect(workspace.launch.configurations.filter(configuration => configuration.name === 'mnci: lint')).toHaveLength(1)
    expect(workspace.launch.configurations.map(configuration => configuration.name)).toEqual(
      expect.arrayContaining(['mnci: build', 'mnci: test', 'mnci: lint', 'mnci: typecheck']),
    )
  })

  it('deletes every formatter config a past mnci version could have written', () => {
    // Load-bearing, not tidying, and the reason is that these files are INERT
    // from the command line — nothing runs Prettier or oxfmt any more. That is
    // exactly what makes them dangerous: a globally installed
    // `esbenp.prettier-vscode` or `oxc.oxc-vscode` still resolves one and still
    // reformats on save, quietly undoing Standard while `npm run lint` reports
    // nothing, because the damage lands after the last check ran.
    //
    // All six shapes mnci has shipped: `.prettierrc` from create-nx-workspace,
    // `.prettierrc.json` and `.prettierrc.mjs` from mnci itself, `.prettierignore`,
    // and the oxlint pair.
    for (const stale of RETIRED_FORMATTER_FILES) {
      writeFileSync(join(workspaceRoot, stale), '{}\n')
    }

    overlayWith(DEFAULT_STACK)

    for (const stale of RETIRED_FORMATTER_FILES) {
      expect(existsSync(join(workspaceRoot, stale))).toBe(false)
    }
    // ...and exactly one config remains, because there is exactly one tool.
    expect(existsSync(join(workspaceRoot, 'eslint.config.mjs'))).toBe(true)
  })

  it('deletes the .vscode directory, whose content the .code-workspace file already carries', () => {
    mkdirSync(join(workspaceRoot, '.vscode'), { recursive: true })
    writeFileSync(join(workspaceRoot, '.vscode/extensions.json'), '{}')

    overlayWith(DEFAULT_STACK)

    expect(existsSync(join(workspaceRoot, '.vscode'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'demo.code-workspace'))).toBe(true)
  })

  // What `nx configure-ai-agents` writes: its rules between two marker
  // comments, which is what lets the block be replaced without touching the
  // rest of a file the user also writes in.
  const NX_AGENT_RULES_FIXTURE = [
    '<!-- nx configuration start-->',
    '<!-- Leave the start & end comments to automatically receive updates. -->',
    '',
    '# General Guidelines for working with Nx',
    '',
    '- Prefer running tasks through nx.',
    '<!-- nx configuration end-->',
    '',
  ].join('\n')

  it('deletes every piece of create-nx-workspace 23.x AI-agent scaffolding', () => {
    // A pristine `mnci new` used to end with "eslint could not format '.'
    // (exit code 1)" and a RED `npm run lint`, because three copies of
    // create-nx-workspace's `monitor-ci` scripts fail @mnci/eslint-config with
    // 36 errors. `--aiAgents=none` does not help - measured against the real
    // binary on 23.2.1, in both the `=none` and space-separated forms, and the
    // generated tree is byte-identical either way.
    //
    // The list has to be COMPLETE. Nx nags "Your AI agent configuration is
    // outdated" when an agent has both an MCP config and rules present, so a
    // PARTIAL delete leaves every `nx` command printing it forever.
    // `.github/agents` and `.github/prompts` are the two easiest to miss.
    const scaffolding = [
      '.agents/skills/monitor-ci/scripts/ci-poll-decide.mjs',
      '.claude/settings.json',
      '.codex/config.toml',
      '.cursor/rules.md',
      '.gemini/settings.json',
      '.opencode/skills/monitor-ci/scripts/ci-state-update.mjs',
      '.github/agents/nx.md',
      '.github/prompts/nx.md',
      '.github/skills/monitor-ci/scripts/ci-poll-decide.mjs',
      'AGENTS.md',
      'CLAUDE.md',
      'opencode.json',
    ]
    for (const file of scaffolding) {
      mkdirSync(dirname(join(workspaceRoot, file)), { recursive: true })
      // `AGENTS.md` and `CLAUDE.md` are removed by what they CONTAIN, not by
      // where they are, so the fixture has to be what Nx actually writes -
      // its rules wrapped in the marker comments. The tests below cover the
      // hand-written cases that distinction exists for.
      writeFileSync(join(workspaceRoot, file), NX_AGENT_RULES_FIXTURE)
    }

    overlayWith(DEFAULT_STACK)

    for (const file of scaffolding) {
      expect(existsSync(join(workspaceRoot, file))).toBe(false)
    }
    // The directories that held nothing else go too. `.claude` is removed by
    // content (only Nx's settings.json), so it is the one that used to survive
    // empty - and an empty `.claude/` still reads as agent scaffolding.
    expect(existsSync(join(workspaceRoot, '.claude'))).toBe(false)
    // And `.github` itself survives, because the removal names SUBDIRECTORIES
    // rather than the directory - `mnci` writes `workflows/ci.yml` and
    // `dependabot.yml` into it on the github path, and deleting `.github`
    // wholesale would take them with it. This fixture is on the azure path, so
    // the directory is what there is to check here; the e2e covers the github
    // one with the real files present.
    expect(existsSync(join(workspaceRoot, '.github'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'azure-pipelines.yml'))).toBe(true)
  })

  it('keeps a CLAUDE.md the user wrote, which has no Nx block in it at all', () => {
    // The bug this replaces: `CLAUDE.md` and `AGENTS.md` were deleted by PATH,
    // and both are - by convention - where a person writes instructions for
    // their own repository. This project's own CLAUDE.md is five hundred lines
    // of hand-written guide with no marker in it, so `mnci upgrade` run here
    // would have deleted all of it.
    const guide = '# My project\n\nRun the tests before pushing.\n'
    writeFileSync(join(workspaceRoot, 'CLAUDE.md'), guide)

    overlayWith(DEFAULT_STACK)

    expect(readFileSync(join(workspaceRoot, 'CLAUDE.md'), 'utf8')).toBe(guide)
  })

  it('keeps what the user added around an Nx block, and drops only the block', () => {
    // The common real shape: Nx wrote its rules, then a person appended their
    // own. Deleting the file takes both; deleting the block takes neither.
    writeFileSync(
      join(workspaceRoot, 'AGENTS.md'),
      `${NX_AGENT_RULES_FIXTURE}\n## House rules\n\nNever squash-merge.\n`,
    )

    overlayWith(DEFAULT_STACK)

    const kept = readFileSync(join(workspaceRoot, 'AGENTS.md'), 'utf8')
    expect(kept).toContain('Never squash-merge.')
    expect(kept).not.toContain('nx configuration start')
    expect(kept).not.toContain('Prefer running tasks through nx.')
  })

  it('keeps the agents a user defined under .claude, and removes only Nx settings', () => {
    // `.claude` was deleted wholesale. It holds `settings.json`, which Nx does
    // write, alongside `agents/` and `commands/`, which it does not.
    mkdirSync(join(workspaceRoot, '.claude/agents'), { recursive: true })
    writeFileSync(join(workspaceRoot, '.claude/agents/reviewer.md'), '# reviewer\n')
    writeFileSync(join(workspaceRoot, '.claude/settings.json'), '{}\n')

    overlayWith(DEFAULT_STACK)

    expect(existsSync(join(workspaceRoot, '.claude/agents/reviewer.md'))).toBe(true)
    expect(existsSync(join(workspaceRoot, '.claude/settings.json'))).toBe(false)
    // Not empty, so the directory stays.
    expect(existsSync(join(workspaceRoot, '.claude'))).toBe(true)
  })

  it('leaves no blank lines behind on a CRLF checkout', () => {
    // The excision trimmed only `\n`, so on Windows - the platform this
    // project's own e2e runs on - every carriage return survived as a blank
    // line at the top of the user's file.
    const crlf = `${NX_AGENT_RULES_FIXTURE}\n# My project\n`.replaceAll('\n', '\r\n')
    writeFileSync(join(workspaceRoot, 'CLAUDE.md'), crlf)

    overlayWith(DEFAULT_STACK)

    expect(readFileSync(join(workspaceRoot, 'CLAUDE.md'), 'utf8'))
      .toMatch(/^# My project/)
  })

  it('deletes a file that was nothing but an Nx block', () => {
    // What `create-nx-workspace` leaves: no user content, so nothing to keep.
    writeFileSync(join(workspaceRoot, 'CLAUDE.md'), NX_AGENT_RULES_FIXTURE)

    overlayWith(DEFAULT_STACK)

    expect(existsSync(join(workspaceRoot, 'CLAUDE.md'))).toBe(false)
  })

  it('leaves a missing agent file alone rather than creating one', () => {
    overlayWith(DEFAULT_STACK)

    expect(existsSync(join(workspaceRoot, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'AGENTS.md'))).toBe(false)
  })

  it('removes the local-registry scaffolding a publishable lib left behind', () => {
    // `@nx/js:lib --publishable` scaffolds a whole second publishing
    // mechanism - verdaccio config, devDependency, root target - that mnci's
    // tag-only release model never uses. All three halves have to go together:
    // deleting the config while leaving the target is a target pointing at a
    // file that is not there.
    mkdirSync(join(workspaceRoot, '.verdaccio'), { recursive: true })
    writeFileSync(join(workspaceRoot, '.verdaccio/config.yml'), 'storage: ../tmp\n')
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({
        name:            '@org/source',
        private:         true,
        devDependencies: { nx: '23.0.0', verdaccio: '^6.3.2' },
        nx:              {
          includedScripts: [],
          targets:         { 'local-registry': { executor: '@nx/js:verdaccio' } },
        },
      }),
    )

    overlayWith(DEFAULT_STACK)

    expect(existsSync(join(workspaceRoot, '.verdaccio'))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
      nx:              { targets: Record<string, unknown> }
    }
    // The MERGE is what would otherwise carry both across an upgrade, which is
    // why each is dropped explicitly rather than just not written.
    expect(manifest.devDependencies.verdaccio).toBeUndefined()
    expect(manifest.nx.targets['local-registry']).toBeUndefined()
    // And the rest of the block survives - this is a removal, not a reset.
    expect(manifest.devDependencies.nx).toBe('23.0.0')
    expect(manifest.nx.targets.lint).toBeDefined()
  })

  it('sweeps per-project eslint configs, so `mnci upgrade` de-fragments an old workspace', () => {
    // This is the migration path that matters. `mnci add` deletes the config
    // its own generator writes, but that only helps projects created from now
    // on — a workspace generated before mnci owned linting carries one in every
    // project directory, and without this an upgrade would install the root
    // config while leaving each project linting against its own stale rules.
    for (const projectRoot of ['apps/web', 'libs/utils', 'packages/sdk']) {
      mkdirSync(join(workspaceRoot, projectRoot), { recursive: true })
      writeFileSync(join(workspaceRoot, projectRoot, 'eslint.config.mjs'), 'export default []')
    }
    // A non-default extension, and a path outside the three project dirs.
    writeFileSync(join(workspaceRoot, 'apps/web/eslint.config.cjs'), 'module.exports = []')
    mkdirSync(join(workspaceRoot, 'tools/gen'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'tools/gen/eslint.config.mjs'), 'export default []')

    overlayWith(DEFAULT_STACK)

    for (const projectRoot of ['apps/web', 'libs/utils', 'packages/sdk']) {
      expect(existsSync(join(workspaceRoot, projectRoot, 'eslint.config.mjs'))).toBe(false)
    }
    expect(existsSync(join(workspaceRoot, 'apps/web/eslint.config.cjs'))).toBe(false)
    // The root config is the one that must survive.
    expect(existsSync(join(workspaceRoot, 'eslint.config.mjs'))).toBe(true)
    // Only the three conventional project directories are swept — a config a
    // user put somewhere else is theirs, not mnci's to delete.
    expect(existsSync(join(workspaceRoot, 'tools/gen/eslint.config.mjs'))).toBe(true)
  })

  it('is idempotent when the Nx scaffolding it removes is already gone', () => {
    // This is what lets `mnci upgrade` repair an existing workspace.
    expect(() => overlayWith(DEFAULT_STACK)).not.toThrow()
    expect(() => overlayWith(DEFAULT_STACK)).not.toThrow()
  })

  // The options themselves are asserted in @mnci/eslint-config's own suite, by
  // running the real Prettier binary against fixtures. They cannot be asserted
  // here: the package is ESM and these specs run as CJS under ts-jest, so
  // importing it fails to parse — the same wall that file's header documents.

  it('writes an .npmrc that can actually authenticate a publish', () => {
    overlayWith(DEFAULT_STACK)

    // The fixture is a public-npm workspace, so this is the auth-only variant:
    // one directive, no scope routing. It used to be comment-only, which meant
    // every generated workspace's `npm publish` failed to authenticate while CI
    // exported a token nothing consumed.
    const npmrc = readFileSync(join(workspaceRoot, '.npmrc'), 'utf8')
    const directives = npmrc
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith(';'))

    expect(directives).toEqual(['//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}'])
  })

  // Skipped on Windows, where the assertion cannot hold and the product is not
  // at fault: NTFS has no executable bit, so Node's `chmod` only toggles the
  // read-only flag and `mode & 0o111` is always 0. Git knows this and sets
  // `core.fileMode=false` there, so the hook runs regardless. The invariant is
  // real on POSIX — git silently refuses a non-executable hook — which is why
  // this is gated rather than deleted.
  itOnPosix('marks the commit-msg hook executable (git refuses to run it otherwise)', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    const mode = statSync(join(workspaceRoot, '.husky/commit-msg')).mode
    expect(mode & 0o111).not.toBe(0)
  })

  it('stamps the dual TypeScript compiler into devDependencies (TS6 API + TS7 tsc)', () => {
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({
        name:            '@org/source',
        devDependencies: { typescript: '~6.0.3', nx: '23.0.0' },
      }),
    )

    overlayWith(DEFAULT_STACK)

    const devDependencies = (
      JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>
      }
    ).devDependencies
    // typescript is aliased to the TS6 package (API intact; its bin is tsc6, not tsc)…
    expect(devDependencies.typescript).toBe('npm:@typescript/typescript6@^6.0.2')
    // …and @typescript/native provides the TS7 `tsc`.
    expect(devDependencies['@typescript/native']).toBe('npm:typescript@^7.0.2')
    // Unrelated devDeps are preserved.
    expect(devDependencies.nx).toBe('23.0.0')
  })

  it('stamps the chosen scope into the root package name, preserving the rest', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    const manifest = JSON.parse(
      readFileSync(join(workspaceRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(manifest.name).toBe('@demo/source')
    expect(manifest.private).toBe(true)
    // Existing devDeps preserved (the dual TS compiler is added on top).
    expect(manifest.devDependencies).toMatchObject({ nx: '23.0.0' })
  })

  it('stamps the curated root scripts — single cross-platform commands only', () => {
    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const {
      'python:install': pythonInstall,
      format,
      'format:check': formatCheck,
      ...rest
    } = manifest.scripts
    expect(rest).toEqual({
      'build':           'nx run-many -t build',
      'lint':            'nx run-many -t lint',
      'test':            'nx run-many -t test',
      // Its own script because nothing else type-checks: a bundler-built
      // project's `build` strips types without reading them.
      'typecheck':       'nx run-many -t typecheck',
      'affected':        'nx affected -t lint,typecheck,test,build',
      'graph':           'nx graph',
      'release:preview': 'nx release --dry-run',
      'prepare':         'husky',
    })
    expect(format).toBe('eslint . --fix --cache')
    // No `format:check`: with one tool, `lint` already reports formatting.
    expect(formatCheck).toBeUndefined()
    // The local-dev counterpart of the CI Python-install guards — see the
    // dedicated `python:install` describe block below for the full assertions.
    expect(pythonInstall).toContain('-m pip install -r requirements-dev.txt')
    expect(pythonInstall).toContain('globSync(\'apps/*/pyproject.toml\')')
  })

  it('keeps any scripts the preset generated that the curated set does not own', () => {
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: '@org/source', scripts: { postinstall: 'echo hi' } }),
    )

    applyOverlay(workspaceRoot, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'azure',
      stack:         DEFAULT_STACK,
    })

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts.postinstall).toBe('echo hi')
    expect(manifest.scripts.build).toBe('nx run-many -t build')
  })
})

describe('removeLocalRegistryScaffolding', () => {
  // The `mnci add` path, which never goes near the overlay: adding a
  // publishable library to an existing workspace re-scaffolds all three halves
  // every time, so this has to stand on its own.
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-verdaccio-'))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  const writeManifest = (manifest: unknown): void =>
    writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify(manifest))

  const readManifest = (): Record<string, unknown> =>
    JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as Record<string, unknown>

  it('removes all three halves and leaves the rest of the manifest alone', () => {
    mkdirSync(join(workspaceRoot, '.verdaccio'), { recursive: true })
    writeFileSync(join(workspaceRoot, '.verdaccio/config.yml'), 'storage: ../tmp\n')
    writeManifest({
      name:            '@org/source',
      devDependencies: { nx: '23.0.0', verdaccio: '^6.3.2' },
      nx:              { includedScripts: [], targets: { 'local-registry': {}, 'lint': {} } },
    })

    removeLocalRegistryScaffolding(workspaceRoot)

    expect(existsSync(join(workspaceRoot, '.verdaccio'))).toBe(false)
    const manifest = readManifest() as {
      devDependencies: Record<string, string>
      nx:              { includedScripts: unknown[], targets: Record<string, unknown> }
    }
    expect(manifest.devDependencies).toEqual({ nx: '23.0.0' })
    expect(manifest.nx.targets).toEqual({ lint: {} })
    expect(manifest.nx.includedScripts).toEqual([])
  })

  it('keeps every untouched key in its original position', () => {
    // Rebuilding the manifest from a spread moves `devDependencies` and `nx`
    // to the end of the file, which is a diff in every generated workspace for
    // no reason at all.
    writeManifest({
      name:            '@org/source',
      devDependencies: { verdaccio: '^6.3.2', nx: '23.0.0' },
      private:         true,
      nx:              { targets: { 'local-registry': {}, 'lint': {} } },
      workspaces:      ['packages/*'],
    })

    removeLocalRegistryScaffolding(workspaceRoot)

    expect(Object.keys(readManifest())).toEqual([
      'name',
      'devDependencies',
      'private',
      'nx',
      'workspaces',
    ])
  })

  it('drops a container that emptying leaves with nothing in it', () => {
    // A stray `{}` would read as deliberate; nothing else in a generated
    // manifest carries one.
    writeManifest({ name: '@org/source', devDependencies: { verdaccio: '^6.3.2' }, nx: { targets: { 'local-registry': {} } } })

    removeLocalRegistryScaffolding(workspaceRoot)

    expect(readManifest()).toEqual({ name: '@org/source' })
  })

  it('changes nothing on a workspace that never had it', () => {
    writeManifest({ name: '@org/source', devDependencies: { nx: '23.0.0' } })
    const before = readFileSync(join(workspaceRoot, 'package.json'), 'utf8')

    removeLocalRegistryScaffolding(workspaceRoot)

    expect(readManifest()).toEqual({ name: '@org/source', devDependencies: { nx: '23.0.0' } })
    expect(before).toContain('23.0.0')
  })
})

describe('what `mnci upgrade` keeps in a pipeline', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'mnci-pipeline-keep-'))
    writeFileSync(join(workspace, 'nx.json'), JSON.stringify({ $schema: 's', namedInputs: {} }))
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: '@org/source', private: true, devDependencies: { nx: '23.0.0' } }))
  })

  afterEach(() => rmSync(workspace, { force: true, recursive: true }))

  /** Applies the overlay for both providers, as `mnci upgrade` would. */
  function apply (): void {
    applyOverlay(workspace, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'both',
      stack:         DEFAULT_STACK,
    })
  }

  const read = (file: string): string => readFileSync(join(workspace, file), 'utf8')
  const write = (file: string, text: string): void => writeFileSync(join(workspace, file), text)

  it('writes the three slots and both choosable phase blocks into each provider', () => {
    apply()

    for (const file of ['.github/workflows/ci.yml', 'azure-pipelines.yml']) {
      const text = read(file)

      for (const slot of ['after-install', 'before-release', 'after-release']) {
        expect(text).toContain(`# mnci:slot ${slot} `)
        expect(text).toContain(`# mnci:slot-end ${slot}`)
      }
      for (const phase of ['pack', 'release']) {
        expect(text).toContain(`# mnci:phase ${phase} `)
        expect(text).toContain(`# mnci:phase-end ${phase}`)
      }
    }
  })

  it('is stable: a second upgrade changes nothing', () => {
    apply()
    const first = [read('.github/workflows/ci.yml'), read('azure-pipelines.yml')]

    apply()

    expect([read('.github/workflows/ci.yml'), read('azure-pipelines.yml')]).toEqual(first)
  })

  it("keeps a team's own step across an upgrade, in both providers", () => {
    apply()
    write('.github/workflows/ci.yml', read('.github/workflows/ci.yml').replace(
      '# mnci:slot-end after-install',
      '- run: ./scripts/warm-cache.sh\n      # mnci:slot-end after-install',
    ))
    write('azure-pipelines.yml', read('azure-pipelines.yml').replace(
      '# mnci:slot-end after-install',
      '- script: ./scripts/warm-cache.sh\n  # mnci:slot-end after-install',
    ))

    apply()

    expect(read('.github/workflows/ci.yml')).toContain('      - run: ./scripts/warm-cache.sh')
    expect(read('azure-pipelines.yml')).toContain('  - script: ./scripts/warm-cache.sh')
  })

  it('keeps the slot content when the Azure steps move under jobs: for a native app', () => {
    apply()
    write('azure-pipelines.yml', read('azure-pipelines.yml').replace(
      '# mnci:slot-end after-install',
      '- script: ./scripts/warm-cache.sh\n  # mnci:slot-end after-install',
    ))
    mkdirSync(join(workspace, 'apps/tray'), { recursive: true })
    writeFileSync(join(workspace, 'apps/tray/project.json'), JSON.stringify({ tags: ['build:cgo'] }))

    apply()

    expect(read('azure-pipelines.yml')).toContain('\n      - script: ./scripts/warm-cache.sh\n')
    expect(() => yaml.load(read('azure-pipelines.yml'))).not.toThrow()
  })

  it('keeps the release phase off once the team removed it, and stays valid YAML', () => {
    apply()
    write('.github/workflows/ci.yml', read('.github/workflows/ci.yml').replace(/ {6}# mnci:phase release[\s\S]*?# mnci:phase-end release\n/, ''))

    apply()
    const workflow = read('.github/workflows/ci.yml')

    expect(workflow).toContain('# - run: npx mnci ci release')
    expect(workflow).not.toMatch(/^\s*- run: npx mnci ci release/m)
    expect(workflow).toMatch(/^\s*- run: npx mnci ci pack/m)
    expect(() => yaml.load(workflow)).not.toThrow()
  })

  it('regenerates a pipeline from before the markers whole, and says so', () => {
    mkdirSync(join(workspace, '.github/workflows'), { recursive: true })
    write('.github/workflows/ci.yml', 'name: old\n')
    const lines: string[] = []

    applyOverlay(workspace, {
      workspaceName: 'demo',
      scope:         '@demo',
      registry:      { kind: 'npm' },
      agent:         'ubuntu-latest',
      variableGroup: 'Build',
      ci:            'github',
      stack:         DEFAULT_STACK,
    }, line => { lines.push(line) })

    expect(read('.github/workflows/ci.yml')).toContain('# mnci:slot after-install')
    expect(lines.some(line => line.includes('written before mnci kept user slots'))).toBe(true)
  })
})

describe('mergeOverrides', () => {
  it('merges one level into an entry both sides have, mnci winning the keys it owns', () => {
    expect(mergeOverrides({ nx: { a: '1', mine: '9' } }, { nx: { a: '2', b: '3' } })).toEqual({ nx: { a: '2', b: '3', mine: '9' } })
  })

  it('keeps entries only the workspace has, and adds entries only mnci has', () => {
    expect(mergeOverrides({ 'left-pad': '1.0.0' }, { 'eslint-plugin-x': { eslint: '$eslint' } })).toEqual({
      'left-pad':        '1.0.0',
      'eslint-plugin-x': { eslint: '$eslint' },
    })
  })

  it('replaces a value that is not an object on both sides, and works with no existing overrides', () => {
    expect(mergeOverrides({ a: '1' }, { a: { nested: '2' } })).toEqual({ a: { nested: '2' } })
    expect(mergeOverrides({ a: { nested: '2' } }, { a: '1' })).toEqual({ a: '1' })
    expect(mergeOverrides(undefined, { a: '1' })).toEqual({ a: '1' })
  })
})
