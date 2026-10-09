import { spawnSync } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasGoProject, isNxGoPluginRegistered, NX_GO_PLUGIN, parseGoWorkUses } from '../go-workspace'
import { runCapture } from '../nx-workspace'
import { hasStaleLocalRegistry } from '../lockfile-pruning'
import { readNativeBuildConfig } from '../native-build-config'
import { inspectPipeline } from '../pipeline-customization'
import {
  ESLINT_MNCI_FILENAME,
  ESLINT_USER_FILENAME,
  ESLINT_VERSION,
  hasNativeGoApp,
  RETIRED_FORMATTER_FILES,
  type RegistryConfig,
} from '../workspace-overlay'
import {
  canAddDeclarationSpecifierPlugin,
  canRepairRollupConfig,
  hasDeclarationSpecifierPlugin,
  hasDirectoryAwareDeclarationSpecifiers,
  hasRollupSourceMaps,
  resolveRollupConfigText,
} from '../rollup-library'
import { fileExists, readJson } from '../file-system'
import { logger, printJson } from '../terminal'
import { checkReactAppOutput } from './check-react-app-output.use-case'
import { checkReleaseTagsResolve } from './check-release-tags-resolve.use-case'
import { checkTagsMatchRegistry } from './check-tags-match-registry.use-case'
import type { Finding } from './finding.contract'

/** The ESLint major this stack supports, derived from the version mnci pins. */
const SUPPORTED_ESLINT_MAJOR = ESLINT_VERSION.replace(/^\D*/, '').split('.', 1)[0]

/**
 * Normalises a `globSync` result to forward slashes.
 *
 * @remarks
 * Load-bearing on Windows, where `globSync` returns `packages\name\file`. Two
 * checks here split those results on `'/'`, and on a backslash path
 * `lastIndexOf('/')` is `-1`, so `slice(0, -1)` silently drops the last
 * character instead of the filename. The resulting path resolves to nothing,
 * which turned {@link checkVersionActions} — the highest-consequence check in
 * this file — into a check that reported a failure for EVERY publishable
 * Dart/Python package on Windows, including correctly configured ones, under a
 * mangled name. A doctor that cries wolf on a healthy workspace is worse than
 * one that stays quiet.
 *
 * @param path - A workspace-relative path from `globSync`.
 * @returns The same path with forward slashes.
 * @throws Never - performs a pure string replacement.
 * @typeParam None - this function has no generic type parameters.
 */
function toPosix (path: string): string {
  return path.replaceAll('\\', '/')
}

/**
 * Checks that the workspace has exactly one ESLint config, at the root.
 *
 * @remarks
 * The invariant that actually broke in practice, twice over: every `@nx/*`
 * generator writes a per-project config, and a workspace generated before mnci
 * owned linting has one in every project directory. Either way the root config
 * stops being the only opinion, silently, because each project lints against
 * whichever config sits nearest it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The findings for the root config and the per-project sweep.
 * @throws Never - only reads the filesystem.
 * @typeParam None - this function has no generic type parameters.
 */
function checkEslintConfigs (workspaceRoot: string): Finding[] {
  const rootConfigs = globSync('eslint.config.{js,mjs,cjs,ts,mts,cts}', { cwd: workspaceRoot })
  const projectConfigs = globSync('{apps,libs,packages}/*/eslint.config.{js,mjs,cjs,ts,mts,cts}', {
    cwd: workspaceRoot,
  }).map(config => toPosix(config))

  return [
    {
      check: 'root ESLint config',
      ok:    rootConfigs.length === 1,
      detail:
        rootConfigs.length === 0
          ? 'no eslint.config.* at the workspace root'
          : `${rootConfigs.length} root configs: ${rootConfigs.join(', ')}`,
      remedy: 'run `mnci upgrade` to rewrite the root config',
    },
    {
      check:  'no per-project ESLint configs',
      ok:     projectConfigs.length === 0,
      detail: `found ${projectConfigs.length}: ${projectConfigs.join(', ')}`,
      remedy: 'run `mnci upgrade`, which sweeps {apps,libs,packages}/*/eslint.config.*',
    },
    ...checkEslintEntryPointReachesTheRules(workspaceRoot),
  ]
}

/**
 * Fails when `eslint.config.mjs` no longer reaches the rules mnci writes.
 *
 * @remarks
 * The two files are split so that `mnci upgrade` can rewrite the rules without
 * touching the workspace's own blocks — which is only true while the workspace's
 * file still imports the other one. A config that has stopped doing so lints
 * against whatever it does import and nothing else, and it does that quietly:
 * ESLint is perfectly happy with a config that carries no rules, so `lint`
 * passes and every file in the repository drifts.
 *
 * Only asked once `eslint.config.mnci.mjs` exists, so a workspace that has not
 * been upgraded yet is not nagged about a file it has never had.
 *
 * Matched on the filename rather than by parsing: a bare substring is enough to
 * tell an import of it from its absence, and running a workspace's config
 * through a parser inside a read-only diagnostic buys nothing.
 *
 * The remedy spells the CALL, `...mnci()`, not `...mnci`. The owned file
 * exports a function so that options still reach `@mnci/eslint-config`, and a
 * remedy a user follows literally has to produce something that works.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns One finding, or none when the split has not been applied here.
 * @throws Never - an unreadable entry point reads as not reaching the rules.
 * @typeParam None - this function has no generic type parameters.
 */
function checkEslintEntryPointReachesTheRules (workspaceRoot: string): Finding[] {
  const rules = join(workspaceRoot, ESLINT_MNCI_FILENAME)
  if (!existsSync(rules)) return []

  const entryPoint = join(workspaceRoot, ESLINT_USER_FILENAME)
  const source = existsSync(entryPoint) ? readFileSync(entryPoint, 'utf8') : ''

  // A config from before the split imports the package itself. It reaches the rules just as well, so it is not
  // broken (#422): it is told, as a warning, that the file mnci keeps current is not in use, and how to switch.
  if (!source.includes(ESLINT_MNCI_FILENAME) && source.includes('@mnci/eslint-config')) {
    return [
      {
        check:   `${ESLINT_USER_FILENAME} imports the mnci rules`,
        ok:      true,
        warning: true,
        detail:  `${ESLINT_USER_FILENAME} imports @mnci/eslint-config directly, so it lints with the rules, but ${ESLINT_MNCI_FILENAME}, which mnci keeps current on upgrade, is not used`,
        remedy:  `to use it, change the specifier of that import from '@mnci/eslint-config' to './${ESLINT_MNCI_FILENAME}'; the call and its options (workspaceRoot, verticalSlices, ...) stay exactly as they are, because the generated file exports a function that passes them on`,
      },
    ]
  }

  return [
    {
      check:  `${ESLINT_USER_FILENAME} imports the mnci rules`,
      ok:     source.includes(ESLINT_MNCI_FILENAME),
      detail: source === ''
        ? `${ESLINT_USER_FILENAME} is missing, so nothing loads the rules`
        : `${ESLINT_USER_FILENAME} never mentions ${ESLINT_MNCI_FILENAME}`,
      remedy:
        `make its first import \`import mnci from './${ESLINT_MNCI_FILENAME}'\` and spread ` +
        '`...mnci()` into the exported array, keeping your own blocks after it — ' +
        'mnci does not rewrite this file, so it cannot do this for you',
    },
  ]
}

/**
 * The root manifest's devDependencies, tolerantly.
 *
 * @remarks
 * `readJson` throws on a missing file, and doctor exists to diagnose exactly
 * the broken workspaces where one might be absent — so it must not die on the
 * thing it is inspecting.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The declared devDependencies, or an empty map.
 * @throws Never - a missing or malformed manifest reads as empty.
 * @typeParam None - this function has no generic type parameters.
 */
function declaredDevDependencies (workspaceRoot: string): Record<string, string> {
  try {
    const manifest = readJson<{ devDependencies?: Record<string, string> }>(
      join(workspaceRoot, 'package.json'),
    )

    return manifest.devDependencies ?? {}
  } catch {
    return {}
  }
}

/**
 * Fails when a retired formatter's config or dependency is still present.
 *
 * @remarks
 * ESLint is the only linter and the only formatter. Two checks used to live
 * here — one for the eslint/oxlint mode split, one for "exactly one formatter
 * declared" — and both are meaningless now that there is nothing to choose.
 * This replaces them with the failure that survived the collapse.
 *
 * A leftover `.prettierrc.mjs`, `.oxfmtrc.json` or `oxlint.config.ts` is inert
 * from the command line, because nothing runs those binaries any more. That is
 * precisely what makes it worth a check: a globally installed
 * `esbenp.prettier-vscode` or `oxc.oxc-vscode` still resolves the config and
 * still reformats on save, so the editor quietly undoes Standard — semicolons
 * come back, `function f (a)` loses its space — while `npm run lint` reports
 * nothing, because the damage lands after the last check ran. A declared
 * `prettier` in `devDependencies` is the same trap by the other route, since
 * the extension resolves the formatter from the project.
 *
 * `mnci upgrade` removes all of them; this reports a workspace that has not
 * been upgraded yet, and names the command that fixes it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The finding.
 * @throws Never - only reads the filesystem.
 * @typeParam None - this function has no generic type parameters.
 */
function checkNoRetiredFormatter (workspaceRoot: string): Finding {
  const files = RETIRED_FORMATTER_FILES.filter(file => fileExists(join(workspaceRoot, file)))
  const declared = ['prettier', 'eslint-config-prettier', 'oxlint', 'oxfmt', '@mnci/oxlint-config']
    .filter(name => declaredDevDependencies(workspaceRoot)[name] !== undefined)
  const stale = [...files, ...declared]

  if (stale.length === 0) {
    return { check: 'ESLint is the only linter and formatter', ok: true }
  }

  return {
    check: 'no retired formatter is still configured',
    ok:    false,
    detail:
      `Found: ${stale.join(', ')}. These no longer run, but an editor extension ` +
      'still resolves them and will reformat on save against an opinion no gate ' +
      'checks.',
    remedy: "Run 'mnci upgrade' to remove them.",
  }
}

/**
 * Checks that `@nx/eslint/plugin` is registered in `nx.json`.
 *
 * @remarks
 * This registration is what turns the single root config into a `lint` target on
 * every project. Without it, `npm run lint` still exits 0 while linting nothing —
 * a green check that proves nothing, which is worse than a red one.
 *
 * @param nxJson - The parsed `nx.json`.
 * @returns The finding.
 * @throws Never - pure inspection.
 * @typeParam None - this function has no generic type parameters.
 */
function checkEslintPlugin (nxJson: Record<string, unknown>): Finding {
  const plugins = (nxJson.plugins as unknown[] | undefined) ?? []
  const registered = plugins.some(
    entry =>
      (typeof entry === 'string' ? entry : (entry as { plugin?: string }).plugin) ===
      '@nx/eslint/plugin',
  )

  return {
    check:  '@nx/eslint/plugin registered',
    ok:     registered,
    detail: 'not in nx.json plugins — every project silently loses its lint target',
    remedy: 'run `mnci upgrade`',
  }
}

/**
 * Checks that the ESLint actually installed is the major this stack supports.
 *
 * @remarks
 * The exact bug this command exists for. mnci pins ESLint 9 because
 * `eslint-plugin-react` has no ESLint 10 release, but a declared range and the
 * **resolved** version are different things: this repo carried four package
 * manifests declaring `^10` while the docs said 9, and the resolved binary was 10.
 * Nothing failed, because the repo has no `.tsx` of its own — the drift was only
 * visible by asking `node_modules` what actually got installed.
 *
 * Skipped rather than failed when there are no `node_modules`, since "not
 * installed yet" is not a drift.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The finding, or `undefined` when nothing is installed to inspect.
 * @throws Never - a malformed manifest yields no finding.
 * @typeParam None - this function has no generic type parameters.
 */
function checkResolvedEslint (workspaceRoot: string): Finding | undefined {
  const manifestPath = join(workspaceRoot, 'node_modules/eslint/package.json')
  if (!fileExists(manifestPath)) {
    return undefined
  }
  try {
    const { version } = readJson<{ version: string }>(manifestPath)
    const major = version.split('.', 1)[0]

    return {
      check:  `resolved eslint is ${SUPPORTED_ESLINT_MAJOR}.x`,
      ok:     major === SUPPORTED_ESLINT_MAJOR,
      detail: `node_modules/eslint is ${version}, but this stack supports ${SUPPORTED_ESLINT_MAJOR}.x (eslint-plugin-react has no release beyond it)`,
      remedy: `pin eslint to ${ESLINT_VERSION} in every package manifest, then reinstall`,
    }
  } catch {
    return undefined
  }
}

/**
 * Checks that `.npmrc` matches the registry the workspace recorded.
 *
 * @remarks
 * Only meaningful now that publish auth is wired: the two registry kinds get
 * genuinely different files, so a workspace whose `.npmrc` predates its recorded
 * registry choice cannot publish. An `azure-artifacts` workspace additionally
 * needs its scope routed, which is what keeps a scoped package off npmjs.org.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param registry - The registry persisted in `nx.json`'s `mnci` block.
 * @param scope - The npm scope persisted alongside it.
 * @returns The finding, or `undefined` when nothing is persisted to compare against.
 * @throws Never - only reads the filesystem.
 * @typeParam None - this function has no generic type parameters.
 */
function checkNpmrc (
  workspaceRoot: string,
  registry: RegistryConfig | undefined,
  scope: string | undefined,
): Finding | undefined {
  const npmrcPath = join(workspaceRoot, '.npmrc')
  if (!registry || !fileExists(npmrcPath)) {
    return undefined
  }
  const npmrc = readFileSync(npmrcPath, 'utf8')
  if (registry.kind === 'npm') {
    return {
      check:  '.npmrc authenticates the public registry',
      ok:     npmrc.includes('//registry.npmjs.org/:_authToken='),
      detail: 'no npmjs.org token line — `npm publish` cannot authenticate',
      remedy: 'run `mnci upgrade`',
    }
  }

  return {
    check:  '.npmrc routes the scope to the feed',
    ok:     scope !== undefined && npmrc.includes(`${scope}:registry=`),
    detail: `no '${scope ?? '@scope'}:registry=' line — a scoped package could publish to npmjs.org instead of the feed`,
    remedy: 'run `mnci upgrade`',
  }
}

/**
 * Warns when this workspace's `.npmrc` would hand npm an empty credential.
 *
 * @remarks
 * A project `.npmrc` beats the user's one, and the generated file authenticates
 * through an environment variable that only CI exports. So with that variable
 * unset — which is every local shell — npm inside this workspace does not fall
 * back to whatever `npm login` wrote in `~/.npmrc`; it authenticates with an
 * empty string and every write is refused.
 *
 * That is a deliberate trade-off rather than a defect, and the generated
 * `.npmrc` says so in its own comments. This check exists because the comments
 * are in a file nobody reads at the moment they need them, and because **the
 * refusal is easy to misread**: for a write you are not allowed to make, the
 * registry answers
 *
 * ```text
 * npm error 404 Not Found - PUT https://registry.npmjs.org/<package>
 * ```
 *
 * with everything above it being npm listing what it *intended* to send. A long,
 * healthy-looking run changes nothing, and 404 reads as "no such package"
 * rather than "you are not who you need to be".
 *
 * WHAT THIS DOES NOT CHECK, AND WHY NOT
 *
 * Whether the credential is any good. That needs the registry, and `mnci doctor`
 * is a local, read-only, offline-capable check — a diagnostic that fails on a
 * train is a diagnostic people stop running. An expired token produces the
 * *same* misleading 404 as this does, so the remedy names `npm whoami`: one
 * command, and the only one that distinguishes the two.
 *
 * Generic in the variable name rather than looking for `NODE_AUTH_TOKEN`. The
 * public-registry file references that one and the Azure Artifacts file
 * references `${PAT}`, and a third could be added; reading the names out of the
 * file cannot go stale.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param environment - The variables to resolve against. Defaulted rather than
 * read inline so the intent is visible in the signature; every caller uses the
 * default.
 * @returns A finding when the file references a variable nothing has set, and
 * `undefined` when there is no `.npmrc`, it references no variables, or every
 * variable it references is set.
 * @throws Never - an unreadable `.npmrc` is treated as absent.
 * @typeParam None - this function has no generic type parameters.
 */
function checkNpmrcCredentialResolves (
  workspaceRoot: string,
  environment: Record<string, string | undefined> = process.env,
): Finding | undefined {
  const npmrcPath = join(workspaceRoot, '.npmrc')
  if (!fileExists(npmrcPath)) {
    return undefined
  }

  const npmrc = readFileSync(npmrcPath, 'utf8')
  // Credential lines only. A `${VAR}` inside a comment is documentation, and a
  // registry URL could contain one without being a secret.
  const credentials = npmrc
    .split('\n')
    .filter(line => !line.trimStart().startsWith(';') && !line.trimStart().startsWith('#'))
    .filter(line => /(?:_authToken|_password|_auth)\s*=/u.test(line))

  const referenced = [
    ...new Set(
      credentials.flatMap(line =>
        Array.from(line.matchAll(/\$\{(\w+)\}/gu), match => match[1]),
      ),
    ),
  ]
  if (referenced.length === 0) {
    return undefined
  }

  const unset = referenced.filter(name => (environment[name] ?? '') === '')
  if (unset.length === 0) {
    return npmjsCredentialShape(credentials, environment)
  }

  return {
    check: 'npm credentials in this workspace resolve to something',
    ok:    false,
    detail:
      `.npmrc authenticates with \${${unset.join('}, ${')}}, which ${unset.length > 1 ? 'are' : 'is'} ` +
      'unset here — and a project .npmrc beats your user one, so npm will send an EMPTY token from ' +
      'this directory rather than the one `npm login` wrote. Writes are then refused as a 404 on ' +
      'the PUT, which reads like a missing package',
    remedy:
      'nothing, for installing or building — this only affects authenticated commands. To publish ' +
      'or deprecate by hand, run it from outside this workspace, or export a real token first. If ' +
      'it still fails there, `npm whoami` — an expired token gives the same 404',
  }
}

/**
 * Checks that the two halves of build-identity npm auth agree with each other.
 *
 * @remarks
 * Build-identity auth is split across two files that cannot see each other: the
 * `.npmrc` carries no credentials, and `azure-pipelines.yml` runs the task that
 * injects them. Either half alone is broken, and neither breaks loudly:
 *
 * - **A credential-free `.npmrc` with no `npmAuthenticate@0` step** publishes
 *   nothing. `npm ci` still works, since installing a public package never
 *   authenticates, so the pipeline is green until the release step, where the feed
 *   answers 401. This is precisely how a real workspace lost the task: a regenerated
 *   pipeline dropped it and nothing said so until a publish.
 * - **A `.npmrc` that still holds a PAT block, with the step present,** makes the
 *   task append a second credential to a file that already has one. Which of the
 *   two npm ends up sending is not something to leave to chance.
 *
 * Only for an Azure Artifacts workspace with an Azure pipeline. A workspace with no
 * `azure-pipelines.yml` has nothing to disagree with, and public npm has no
 * build identity.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param registry - The registry persisted in `nx.json`'s `mnci` block.
 * @returns A finding when the halves disagree, `undefined` when there is nothing to
 * compare, and an `ok` finding when they agree.
 * @throws Never - an unreadable file is treated as absent.
 * @typeParam None - this function has no generic type parameters.
 */
function checkNpmAuthMatchesPipeline (
  workspaceRoot: string,
  registry: RegistryConfig | undefined,
): Finding | undefined {
  const npmrcPath = join(workspaceRoot, '.npmrc')
  const pipelinePath = join(workspaceRoot, 'azure-pipelines.yml')
  if (registry?.kind !== 'azure-artifacts' || !fileExists(npmrcPath) || !fileExists(pipelinePath)) {
    return undefined
  }

  const holdsCredentials = readFileSync(npmrcPath, 'utf8')
    .split('\n')
    .filter(line => !line.trimStart().startsWith(';') && !line.trimStart().startsWith('#'))
    .some(line => /(?:_authToken|_password|_auth)\s*=/u.test(line))
  const runsTask = readFileSync(pipelinePath, 'utf8').includes('npmAuthenticate@0')

  if (!holdsCredentials && !runsTask) {
    return {
      check: 'npm auth: .npmrc and azure-pipelines.yml agree',
      ok:    false,
      detail:
        '.npmrc carries no credentials and azure-pipelines.yml does not run npmAuthenticate@0, so ' +
        'nothing authenticates the feed — installs still pass, and the release step fails with a 401',
      remedy:
        'run `mnci upgrade --npm-auth build-identity` to add the task, or `mnci upgrade --npm-auth pat` ' +
        'to write the PAT block back',
    }
  }
  if (holdsCredentials && runsTask) {
    return {
      check: 'npm auth: .npmrc and azure-pipelines.yml agree',
      ok:    false,
      detail:
        '.npmrc holds a credential block AND azure-pipelines.yml runs npmAuthenticate@0, which appends ' +
        'a second credential to a file that already has one',
      remedy:
        'run `mnci upgrade --npm-auth build-identity` to drop the PAT block, or `mnci upgrade ' +
        '--npm-auth pat` to drop the task',
    }
  }

  return {
    check:  'npm auth: .npmrc and azure-pipelines.yml agree',
    ok:     true,
    detail: '',
    remedy: '',
  }
}

/**
 * Every current npm token starts with this. Granular and automation tokens have
 * since 2021; the legacy format was a UUID, matched separately below.
 */
const NPM_TOKEN_PREFIX = 'npm_'

/** The legacy npm token format, still valid on very old accounts. */
const LEGACY_NPM_TOKEN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu

/**
 * Warns when the credential bound for npmjs.org is not shaped like an npm token.
 *
 * @remarks
 * A set variable is not a working one, and the failure looks identical. This
 * was found on a real machine: `NODE_AUTH_TOKEN` held an 84-character Azure
 * DevOps PAT, so every mnci workspace generated with `--registry npm` quietly
 * authenticated the **public** registry with an Azure credential and every
 * write came back as the same misleading 404.
 *
 * The name is the hazard. `NODE_AUTH_TOKEN` is what `actions/setup-node`
 * exports, which is why mnci writes it — but it is a generic name, so anything
 * else on the machine that sets it wins inside every generated workspace, and
 * nothing says so.
 *
 * A SHAPE CHECK, AND IT SAYS SO
 *
 * This cannot tell a valid token from a revoked one without the registry, and
 * `mnci doctor` stays offline. What it can do is notice that the value is not
 * an npm token at all — every current one begins `npm_`, and the legacy format
 * is a UUID. Anything else is either a credential for somewhere else or a typo,
 * and both are worth a line. The remedy starts with the local, safe step
 * (where the variable comes from) and only then offers `npm whoami`, run
 * outside the workspace: inside it the project `.npmrc` binds the variable to
 * the public registry, so the command would send the very credential this
 * check has just said probably belongs to another service (#349).
 *
 * The token's value never appears in the output. Its length does, which is
 * enough to recognise what you set without putting a secret on a terminal that
 * may be logged or shared.
 *
 * @param credentials - The `.npmrc` credential lines, comments already removed.
 * @param environment - The variables to resolve against.
 * @returns A finding when an npmjs.org credential is shaped wrongly, else
 * `undefined`.
 * @throws Never - pure string inspection.
 * @typeParam None - this function has no generic type parameters.
 */
function npmjsCredentialShape (
  credentials: string[],
  environment: Record<string, string | undefined>,
): Finding | undefined {
  const line = credentials.find(entry => entry.includes('//registry.npmjs.org/:_authToken='))
  const variable = line === undefined ? undefined : /\$\{(\w+)\}/u.exec(line)?.[1]
  if (variable === undefined) {
    return undefined
  }

  const value = environment[variable] ?? ''
  if (value.startsWith(NPM_TOKEN_PREFIX) || LEGACY_NPM_TOKEN.test(value)) {
    return undefined
  }

  // A warning, not a failure (#423): this reads the machine's environment, not the workspace, and the same workspace is
  // fine on a machine whose variable holds a real token. It is still worth a line, because the credential is sent
  // to the public registry.
  return {
    check:   'the credential bound for npmjs.org looks like an npm token',
    ok:      true,
    warning: true,
    detail:
      `\${${variable}} is set (${value.length} characters) but does not start with '${NPM_TOKEN_PREFIX}' ` +
      'and is not a legacy UUID token, so it is probably a credential for somewhere else — ' +
      `'${variable}' is a generic name that other tooling also sets, and inside this workspace it ` +
      'is sent to the PUBLIC registry. A write then fails as a 404 on the PUT, which reads like a ' +
      'missing package',
    remedy:
      `find where \`${variable}\` is set (shell profile, CI secret, another tool) and whether it is meant for ` +
      `npm. If it is not, unset \`${variable}\` for local work. If it is meant to be an npm token, check it ` +
      'with `npm whoami` run OUTSIDE this workspace (the project .npmrc would send it to the public registry ' +
      'from in here), or set it to a real npm token',
  }
}

/**
 * Checks that every publishable non-npm package keeps its `versionActions` override.
 *
 * @remarks
 * The highest-consequence check here, because the blast radius is the whole
 * workspace rather than the offending project: Nx's default `versionActions` reads
 * a `package.json`, which a Dart, Python or C# package does not have, so it aborts
 * while building the release graph and `nx release` fails for **every** project.
 *
 * All three non-npm shapes are globbed, and C# is listed explicitly rather than
 * left implied: `csharp-lib` is the only C# kind that lands in `packages/`
 * (`csharp-app` and `csharp-function-app` go to `apps/`, `csharp-internal-lib`
 * to `libs/`), so every `.csproj` this glob finds is inside `release.projects`
 * and carries the same whole-workspace failure mode as a Dart or Python one —
 * it just resolves its override to a workspace-relative
 * `tools/csharp-version-actions.cjs` rather than to a plugin.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns One finding per publishable Dart/Python/C# package missing the override.
 * @throws Never - an unreadable `project.json` is reported as missing.
 * @typeParam None - this function has no generic type parameters.
 */
function checkVersionActions (workspaceRoot: string): Finding[] {
  const candidates = [
    ...globSync('packages/*/pubspec.yaml', { cwd: workspaceRoot }),
    ...globSync('packages/*/*.csproj', { cwd: workspaceRoot }),
    ...globSync('python-packages/*/pyproject.toml', { cwd: workspaceRoot }),
  ].map(manifest => toPosix(manifest))

  return candidates.flatMap(manifest => {
    const projectRoot = manifest.slice(0, manifest.lastIndexOf('/'))
    const projectJsonPath = join(workspaceRoot, projectRoot, 'project.json')
    let hasOverride = false
    try {
      const projectJson = readJson<{
        release?: { version?: { versionActions?: string } }
      }>(projectJsonPath)
      hasOverride = Boolean(projectJson.release?.version?.versionActions)
    } catch {
      // No project.json at all, so no override — the initialiser already says so.
    }

    return [
      {
        check:  `${projectRoot} keeps its versionActions override`,
        ok:     hasOverride,
        detail: 'missing — nx release aborts for the ENTIRE workspace, not just this project',
        remedy: `add release.version.versionActions to ${projectRoot}/project.json`,
      },
    ]
  })
}

/**
 * The target options whose value is a single path to a file that must already
 * exist for the target to run.
 *
 * @remarks
 * Deliberately short. `outputPath` is an output, not an input, so it is absent
 * by design; `assets` takes globs and would need matching rather than an
 * existence test. These three are the ones whose absence produces a failure
 * that reads as a compiler problem rather than a config problem.
 */
const TARGET_FILE_OPTIONS = ['main', 'tsConfig', 'packageJson'] as const

/**
 * Reads every Nx target a project declares, from either place it can declare them.
 *
 * @remarks
 * A project can carry targets in `project.json` **and** in `package.json`'s `nx`
 * block, and a real workspace was found doing both for one project with
 * different `main` values in each. Both are read here rather than whichever is
 * found first, so a stale definition cannot hide behind the live one.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param projectRoot - The project's workspace-relative directory.
 * @returns One entry per declaring file, with that file's targets.
 * @throws Never - an unreadable or absent manifest contributes no targets.
 * @typeParam None - this function has no generic type parameters.
 */
function declaredTargets (
  workspaceRoot: string,
  projectRoot: string,
): { source: string; targets: Record<string, { options?: Record<string, unknown> }> }[] {
  const sources: {
    source:  string
    targets: Record<string, { options?: Record<string, unknown> }>
  }[] = []
  for (const [file, extract] of [
    ['project.json', (json: Record<string, unknown>) => json['targets']],
    [
      'package.json',
      (json: Record<string, unknown>) => (json['nx'] as Record<string, unknown>)?.['targets'],
    ],
  ] as const) {
    try {
      const targets = extract(
        readJson<Record<string, unknown>>(join(workspaceRoot, projectRoot, file)),
      )
      if (targets && typeof targets === 'object') {
        sources.push({
          source:  `${projectRoot}/${file}`,
          targets: targets as Record<string, { options?: Record<string, unknown> }>,
        })
      }
    } catch {
      // No manifest, or unparseable — nothing to check, and the other checks
      // already report a workspace that broken.
    }
  }

  return sources
}

/**
 * Checks that every target option naming a file points at a file that exists.
 *
 * @remarks
 * Found in a real hand-built workspace, three times over in one repo: a build
 * target whose `main` was `src/index.ts` in `project.json` and `src/main.ts` in
 * the same project's `package.json`, with **neither** file present, and a
 * library whose `tsConfig` named a `tsconfig.lib.json` that had never been
 * written.
 *
 * Worth a check rather than left to the build because of how it surfaces. Nx
 * hands the path to the executor unvalidated, so the failure arrives as a
 * TypeScript or esbuild error about the compiler finding no inputs — which
 * reads as a broken tsconfig, and sends people to edit the one file that is
 * fine. Nothing anywhere names the missing file.
 *
 * Paths carrying an Nx token (`{workspaceRoot}`, `{projectRoot}`) are skipped:
 * they are resolved by Nx at run time, so testing them literally would report a
 * file that is never meant to exist under that name.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns One finding per target option pointing at a missing file.
 * @throws Never - only reads the filesystem.
 * @typeParam None - this function has no generic type parameters.
 */
function checkTargetFilesExist (workspaceRoot: string): Finding[] {
  const projectRoots = new Set(
    [
      ...globSync('{apps,libs,packages}/*/project.json', { cwd: workspaceRoot }),
      ...globSync('{apps,libs,packages}/*/package.json', { cwd: workspaceRoot }),
    ].map(manifest => toPosix(manifest).split('/').slice(0, 2).join('/')),
  )

  return [...projectRoots].flatMap(projectRoot =>
    declaredTargets(workspaceRoot, projectRoot).flatMap(({ source, targets }) =>
      Object.entries(targets).flatMap(([targetName, target]) =>
        checkOneTargetsFiles(workspaceRoot, source, targetName, target),
      ),
    ),
  )
}

/**
 * Checks one target's file-valued options.
 *
 * @remarks
 * Split out of {@link checkTargetFilesExist} so the sweep stays a flat
 * comprehension rather than four nested loops around a pair of `continue`s.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param source - The manifest that declared the target, for the message.
 * @param targetName - The target's name, for the message.
 * @param target - The target definition to inspect.
 * @returns One finding per option pointing at a missing file.
 * @throws Never - only reads the filesystem.
 * @typeParam None - this function has no generic type parameters.
 */
function checkOneTargetsFiles (
  workspaceRoot: string,
  source: string,
  targetName: string,
  target: { options?: Record<string, unknown> },
): Finding[] {
  return TARGET_FILE_OPTIONS.flatMap(option => {
    const value = target?.options?.[option]
    // A token (`{workspaceRoot}`, `{projectRoot}`) is resolved by Nx at run
    // time, so a literal existence test would report a file that is never
    // meant to exist under that name.
    const checkable = typeof value === 'string' && !value.includes('{')
    if (!checkable || fileExists(join(workspaceRoot, value))) {
      return []
    }

    return [
      {
        check:  `${source} → ${targetName}.${option} points at a real file`,
        ok:     false,
        detail: `${value} does not exist — the target fails as if the compiler were misconfigured`,
        remedy: `create ${value}, or correct ${option} in ${source}`,
      },
    ]
  })
}

/**
 * Checks that the workspace's TypeScript project references are synced.
 *
 * @remarks
 * The one check that shells out, because only Nx can answer it. Reported as a
 * finding rather than left to CI so the fix happens before the push that fails.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The finding.
 * @throws Never - a non-zero exit is the finding, not an error.
 * @typeParam None - this function has no generic type parameters.
 */
function checkSync (workspaceRoot: string): Finding {
  // Captured, not inherited: `doctor --json` must put one document on stdout and nothing else.
  const result = runCapture('npx', ['nx', 'sync:check'], workspaceRoot)

  return {
    check:  'TypeScript project references synced',
    ok:     result.status === 0,
    detail: `nx sync:check failed — a stale project reference was never committed${result.stdout.trim()
? `
${result.stdout.trim()}`
: ''}`,
    remedy: 'run `npx nx sync` and commit the result',
  }
}

/**
 * Whether this machine has a C compiler cgo can use.
 *
 * @remarks
 * Honours `CC`, which is what cgo itself reads, then the three names a compiler goes
 * by. Only the command is probed, not its flags: `CC="gcc -m64"` is a valid setting.
 *
 * @returns True when one of them answers `--version`.
 * @throws Never - a command that cannot be run counts as absent.
 * @typeParam None - this function has no generic type parameters.
 */
function hasCCompiler (): boolean {
  const candidates = [process.env.CC?.split(' ', 1)[0], 'gcc', 'clang', 'cc']

  return candidates.some(command => command !== undefined && command !== '' && spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0)
}

/**
 * Checks that the Go plugin is registered, once the workspace has a Go project.
 *
 * @remarks
 * It is what gives Nx the Go project graph. Without it every target still works, since
 * mnci writes them explicitly, but `nx affected` knows no edge between a Go app and the
 * library it imports, so a change to the library passes CI without testing the app, and
 * nothing reports it. A repository that adopted its own `go.mod` got exactly this, because
 * the bootstrap that registers the plugin only runs when mnci creates the module.
 * Nothing for a workspace without a Go project, so nobody else sees the line.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The finding, or `undefined` for a workspace without a Go project.
 * @throws Error when `nx.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function checkGoPluginRegistered (workspaceRoot: string): Finding | undefined {
  if (!hasGoProject(workspaceRoot)) {
    return undefined
  }

  return {
    check:  `${NX_GO_PLUGIN} is registered in nx.json, so Nx knows which Go project imports which`,
    ok:     isNxGoPluginRegistered(workspaceRoot),
    detail: `${NX_GO_PLUGIN} is not in nx.json plugins: the project graph has no Go edge, so \`nx affected\` skips an app that imports a changed library`,
    remedy: 'run `mnci upgrade`',
  }
}

/**
 * Checks that every `go.work` `use` entry points to a module that still exists.
 *
 * @remarks
 * This is the failure the single-module layout used to avoid: a `use` entry whose directory
 * was removed by hand makes `go list -m` fail, which breaks the **whole** Nx project graph,
 * not just the Go projects. mnci owns `go.work` (its generators add an entry per project), so
 * catching a stale one here is what lets the multi-module layout be safe (#289). Nothing for a
 * workspace with no `go.work` — an adopted flat repo stays single-module and has none.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The finding, or `undefined` when there is no `go.work`.
 * @throws Never - an unreadable `go.work` is treated as empty.
 * @typeParam None - this function has no generic type parameters.
 */
function checkGoWorkInSync (workspaceRoot: string): Finding | undefined {
  const goWorkPath = join(workspaceRoot, 'go.work')
  if (!fileExists(goWorkPath)) {
    return undefined
  }
  const uses = parseGoWorkUses(readFileSync(goWorkPath, 'utf8'))
  const stale = uses.filter(entry => !existsSync(join(workspaceRoot, entry, 'go.mod')))

  return {
    check:  'every go.work `use` entry points to a module that still exists',
    ok:     stale.length === 0,
    detail: `go.work lists ${stale.join(', ')} but there is no go.mod there — \`go list -m\` fails, which breaks the whole Nx project graph`,
    remedy: 'drop the stale `use` line(s) from go.work (mnci owns the file; a removed Go project should have its entry removed)',
  }
}

/**
 * Checks what a workspace with a native (cgo) Go app needs to build it.
 *
 * @remarks
 * Empty for a workspace with no such app, so nobody else sees these lines. Two
 * invariants, both of which `mnci add go-app --cgo` leaves for the user to satisfy:
 *
 * - **The pipelines carry the native job.** The jobs are written when the pipeline
 *   file is, so an app added since the last `mnci upgrade` has none, and CI would
 *   verify it on the one agent that cannot build it.
 * - **A C compiler is installed here.** `nx run <app>:build-native` fails without one.
 *   It is the only check in this file that reads the machine rather than the
 *   workspace, which is the point of it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The findings, none for a workspace without a native app.
 * @throws Never - a pipeline file is only read after `fileExists` found it.
 * @typeParam None - this function has no generic type parameters.
 */
function checkNativeApps (workspaceRoot: string): Finding[] {
  if (!hasNativeGoApp(workspaceRoot)) {
    return []
  }
  const pipelines = [
    { file: '.github/workflows/ci.yml', marker: 'native (${{ matrix.os }})' },
    { file: 'azure-pipelines.yml', marker: '- job: native' },
  ]
  const findings: Finding[] = pipelines
    .filter(({ file }) => fileExists(join(workspaceRoot, file)))
    .map(({ file, marker }) => ({
      check:  `${file} builds the native apps on every OS`,
      ok:     readFileSync(join(workspaceRoot, file), 'utf8').includes(marker),
      detail: `${file} has no native job: CI would verify a cgo app on the one agent that cannot build it`,
      remedy: 'run `mnci upgrade`',
    }))
  findings.push({
    check:  'a C compiler is installed (cgo needs one)',
    ok:     hasCCompiler(),
    detail: 'none of CC, gcc, clang or cc answered --version, so nx run <app>:build-native cannot build here',
    remedy: 'install one: Xcode command line tools on macOS, build-essential on Linux, MinGW-w64 (gcc) on Windows',
  })

  return findings
}

/**
 * Checks that no runtime dependency is declared in the root manifest.
 *
 * @remarks
 * The root/project policy, and the one check that enforces it: **shared
 * development and tool packages belong at the root, runtime dependencies belong
 * to the package that imports them.**
 *
 * Two independent reasons, and the second is the one that bites. The root
 * manifest is `private` and never published, so a runtime dependency declared
 * there reaches no consumer of any package — an installed `@scope/lib` simply
 * fails to resolve it. And `@nx/rollup` externalises exactly what a project's
 * OWN manifest declares, so hoisting a dependency to the root does not make it
 * shared, it makes rollup **inline a private copy of it** into the bundle.
 * Measured on a real generated workspace: moving `axios` out of one package's
 * manifest took its published bundle from 14.5 KB to 832 KB, silently.
 *
 * `@nx/dependency-checks` catches the second half from the other direction — it
 * fails the project whose import is now undeclared — so this check and that
 * lint rule are complementary rather than redundant: the rule names the project
 * that lost the dependency, this names the root that took it.
 *
 * `devDependencies` are deliberately not checked. Sharing the toolchain is the
 * whole point of the root manifest, and npm's `overrides` only work there.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The finding, or `undefined` when there is no root manifest to read.
 * @throws Never - an unreadable manifest is treated as nothing to check.
 * @typeParam None - this function has no generic type parameters.
 */
function checkNoRootRuntimeDependencies (workspaceRoot: string): Finding | undefined {
  const manifestPath = join(workspaceRoot, 'package.json')
  if (!fileExists(manifestPath)) {
    return undefined
  }
  let declared: string[]
  try {
    declared = Object.keys(
      readJson<{ dependencies?: Record<string, string> }>(manifestPath).dependencies ?? {},
    )
  } catch {
    return undefined
  }

  return {
    check:  'no runtime dependencies in the root manifest',
    ok:     declared.length === 0,
    detail: `the root package.json declares ${declared.join(', ')} — the root is private and never published, and @nx/rollup externalises only what a project's own manifest declares, so a package importing one of these ships an inlined private copy instead`,
    remedy: `move ${declared.join(', ')} into the dependencies of each package that imports it (devDependencies at the root are fine — that is what the root is for)`,
  }
}

/**
 * Checks that every rollup-built project can actually be debugged.
 *
 * @remarks
 * The invariant: a publishable library's `rollup.config.cjs` must switch
 * `sourceMap` on. Without it the build emits no `.js.map`, so VS Code cannot
 * map the running JavaScript back to the TypeScript and **every breakpoint in
 * a `.ts` file stays grey and unbound** — with no error, anywhere, to say why.
 * Found exactly that way: from the outside it looks like a broken debugger
 * rather than a build that omitted one flag.
 *
 * A config written before mnci wired this in will never fix itself, because a
 * rollup config is written once at `add` time — hence a check plus the
 * `mnci upgrade` sweep that repairs it.
 *
 * Reads through {@link resolveRollupConfigText} rather than the project's own
 * file text alone, for two reasons found in the same real workspace.
 * `@mnci/eslint-config`'s `@stylistic/key-spacing` (aligned on value) is
 * entitled to rewrite `sourceMap: true,` to `sourceMap:             true,` to
 * line up with the object's longest key — `eslint --fix` is part of the
 * documented pre-commit routine, so a lint-clean config was failing this
 * check on formatting alone. And a workspace that hoists the shared
 * `withNx(...)` call into one root file and leaves each project as
 * `module.exports = require('../../rollup.base.cjs')()` has no
 * `sourceMap: true` text of its own — the flag lives one file away, so
 * reading only the project's file failed every project even when every one
 * genuinely had it on.
 *
 * The remedy is conditional on {@link canRepairRollupConfig} rather than
 * always naming `mnci upgrade`: that command edits the `},` / `{` boundary
 * between `withNx`'s two arguments, which a one-line delegation to a shared
 * base does not have. Recommending it there would send the user in a circle —
 * run the fix, watch it no-op, doctor reports the same failure again — so a
 * config in that shape gets told to edit the shared base by hand instead.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns One finding per rollup config missing the flag.
 * @throws Never - an unreadable config is skipped.
 * @typeParam None - this function has no generic type parameters.
 */
function checkRollupSourceMaps (workspaceRoot: string): Finding[] {
  const configs = globSync(['packages/*/rollup.config.cjs', 'libs/*/rollup.config.cjs'], {
    cwd: workspaceRoot,
  }).map(config => toPosix(config))

  return configs.flatMap(relativePath => {
    const configPath = join(workspaceRoot, relativePath)
    let config: string
    try {
      config = readFileSync(configPath, 'utf8')
    } catch {
      return []
    }

    return [
      {
        check: `source maps enabled in ${relativePath}`,
        ok:    hasRollupSourceMaps(resolveRollupConfigText(configPath)),
        detail:
          'rollup emits no .js.map without it, so a breakpoint in a .ts file can never bind',
        remedy: canRepairRollupConfig(config)
          ? 'run `mnci upgrade`, which adds it to every rollup config'
          : "mnci does not recognise the shape of this config (it edits the boundary between withNx's two arguments, which is not here; a config that delegates via require() to a shared base is one such shape) — add `sourceMap: true` to withNx's first argument by hand; `mnci upgrade` cannot repair a config in this shape",
      },
    ]
  })
}

/**
 * Checks that every rollup-built project publishes resolvable declarations.
 *
 * @remarks
 * The invariant: a rollup config must carry the declaration-specifier plugin,
 * AND that plugin must be the version which resolves a bare relative specifier
 * against what the build actually emitted, rather than appending `.js` to all
 * of them.
 *
 * Worth a check for the same reason the source-map one is, only more so:
 * **there is no failure to notice.** The build succeeds, the package publishes,
 * runtime is unaffected (the bundle never goes through those specifiers), and
 * `skipLibCheck` — the default in most consumers — swallows the unresolved
 * import. All that happens is that every export behind a directory barrel
 * silently becomes `any` for every consumer. It was found by reading a real
 * published tarball, not by anything failing.
 *
 * Reported as two distinct findings because they are different states with
 * different histories, even though `mnci upgrade` fixes both: a config with no
 * plugin at all predates it (or was hand-edited), while a config with the
 * STALE plugin was generated by a version of mnci that had the plugin and got
 * the suffix wrong — and that second one is the dangerous one, because it
 * looks entirely healthy. In a real consuming workspace 9 of 11 published
 * packages sat in exactly that state, purely according to when each was
 * scaffolded.
 *
 * Read through {@link resolveRollupConfigText} rather than the project's own
 * file text, for the reason {@link checkRollupSourceMaps} documents: a
 * workspace that hoists `withNx(...)` into one shared base leaves each project
 * a one-line delegation, and the plugin then lives a file away.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns One finding per rollup config missing or carrying a stale plugin.
 * @throws Never - an unreadable config is skipped.
 * @typeParam None - this function has no generic type parameters.
 */
function checkDeclarationSpecifiers (workspaceRoot: string): Finding[] {
  const configs = globSync(['packages/*/rollup.config.cjs', 'libs/*/rollup.config.cjs'], {
    cwd: workspaceRoot,
  }).map(config => toPosix(config))

  return configs.flatMap(relativePath => {
    const configPath = join(workspaceRoot, relativePath)
    if (!fileExists(configPath)) {
      return []
    }
    const resolved = resolveRollupConfigText(configPath)
    if (!hasDeclarationSpecifierPlugin(resolved)) {
      return [
        {
          check: `${relativePath} normalises declaration specifiers`,
          ok:    false,
          detail:
            'no mnci-normalise-declaration-specifiers plugin — the emitted .d.ts files keep the extensionless imports tsconfig.lib.json allows, which a nodenext consumer cannot resolve',
          // `mnci upgrade` adds the plugin only to a config whose second argument already has a
          // `plugins` array (what @nx/react:library writes). For any other shape it would no-op, and
          // naming a command that silently does nothing is the failure mode the source-map check
          // above goes out of its way to avoid, so the remedy depends on the shape.
          remedy: canAddDeclarationSpecifierPlugin(readFileSync(configPath, 'utf8'))
            ? 'run `mnci upgrade`, which adds the plugin to the plugins array of withNx\'s second argument'
            : "add the plugin to withNx's second argument by hand (copy it from a freshly `mnci add npm-lib`'d project) — mnci does not recognise the shape of this config, so `mnci upgrade` cannot add it",
        },
      ]
    }

    return [
      {
        check: `${relativePath} resolves directory barrels in declarations`,
        ok:    hasDirectoryAwareDeclarationSpecifiers(resolved),
        detail:
          'the plugin appends .js to every bare specifier, including ones naming a directory barrel, which needs /index.js — the named file is never emitted, so every export behind it publishes as `any` with nothing reporting it',
        remedy: 'run `mnci upgrade`, which replaces the plugin body with the current one',
      },
    ]
  })
}

/**
 * Checks that each pipeline still runs the enforced verify phase, and notes the phases switched off.
 *
 * @remarks
 * `verify` is the QA gate and the one phase a team may not remove: a pipeline without an active
 * `mnci ci verify` call builds and releases code nothing checked, while staying green. That fails,
 * and `mnci upgrade` restores it. The choosable phases (`pack`, `release`) are a team's decision,
 * so a switched-off one only warns, naming how to turn it back on.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns A verify finding per pipeline file, plus a warning per switched-off phase.
 * @throws Never - a pipeline file is only read after `fileExists` found it.
 * @typeParam None - this function has no generic type parameters.
 */
function checkPipelinePhases (workspaceRoot: string): Finding[] {
  const files = ['azure-pipelines.yml', '.github/workflows/ci.yml']

  return files
    .filter(file => fileExists(join(workspaceRoot, file)))
    .flatMap(file => {
      const { verifyActive, switchedOff } = inspectPipeline(readFileSync(join(workspaceRoot, file), 'utf8'))
      const verify: Finding = {
        check:  `${file} runs the enforced verify phase`,
        ok:     verifyActive,
        detail: `${file} has no active \`mnci ci verify\` call, so CI would build and release code nothing checked`,
        remedy: 'run `mnci upgrade`, which restores it',
      }
      const warnings = switchedOff.map((phase): Finding => ({
        check:   `${file}: the ${phase} phase is switched off`,
        ok:      true,
        warning: true,
        detail:  `${file} does not run \`mnci ci ${phase}\``,
        remedy:  `uncomment the ${phase} block in ${file} to run it again`,
      }))

      return [verify, ...warnings]
    })
}

/**
 * Checks that the `mnci.native` entry of `nx.json`, when there is one, says something usable.
 *
 * @remarks
 * Its values become arguments of `apt-get` and runner labels in a pipeline, so an entry that is
 * not a valid name is dropped when the pipeline is written and the native job runs without it.
 * That is silent unless something reports it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns One failing finding when the entry has problems, none otherwise.
 * @throws Never - an unreadable `nx.json` has no entry to check.
 * @typeParam None - this function has no generic type parameters.
 */
function checkNativeBuildConfig (workspaceRoot: string): Finding[] {
  const { problems } = readNativeBuildConfig(workspaceRoot)
  if (problems.length === 0) {
    return []
  }

  return [{
    check:  'mnci.native in nx.json is valid',
    ok:     false,
    detail: problems.join('; '),
    remedy: 'fix the entry in the mnci block of nx.json, then run `mnci upgrade`',
  }]
}

/**
 * Checks that `nx release` is not told to preserve matching dependency ranges.
 *
 * @remarks
 * Under mnci's tag-only releases the manifests on disk stay at the scaffold version, so an internal
 * dependency range written then (`^0.0.1`) cannot absorb the first bump, and with
 * `version.preserveMatchingDependencyRanges` on, nx refuses the release in its version phase,
 * before anything is tagged. Every other check stays green, since the release runs on main alone.
 * Only a workspace with a `release` block is asked.
 *
 * @param nxJson - The parsed `nx.json`.
 * @returns A failing finding when the setting is on or absent, a passing one when it is off, none without a release block.
 * @throws Never - pure inspection.
 * @typeParam None - this function has no generic type parameters.
 */
function checkDependencyRangesNotPreserved (nxJson: { release?: { version?: { preserveMatchingDependencyRanges?: unknown } } }): Finding | undefined {
  if (nxJson.release === undefined) {
    return undefined
  }

  return {
    check:  'nx release does not preserve matching dependency ranges',
    ok:     nxJson.release.version?.preserveMatchingDependencyRanges === false,
    detail: 'release.version.preserveMatchingDependencyRanges is not false, so the first release of interdependent packages fails in the version phase, before anything is tagged',
    remedy: 'run `mnci upgrade`, or set release.version.preserveMatchingDependencyRanges to false in nx.json',
  }
}

/**
 * Checks that the lockfile does not keep the local registry no manifest asks for.
 *
 * @remarks
 * `verdaccio` stays in the lockfile as an optional peer of `@nx/js` after the root dependency is
 * removed, with a chain that includes `braces`, which has no patched release. `npm audit` then
 * reports six high advisories on a workspace that uses none of it, and the pipeline's audit step
 * stops the first run on main.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns A finding when there is a lockfile with the entry, otherwise none.
 * @throws Never - a workspace without a readable lockfile has nothing to report.
 * @typeParam None - this function has no generic type parameters.
 */
function checkLockfileHasNoLocalRegistry (workspaceRoot: string): Finding | undefined {
  if (!fileExists(join(workspaceRoot, 'package-lock.json'))) {
    return undefined
  }

  return {
    check:  'package-lock.json carries no unused local registry (verdaccio)',
    ok:     !hasStaleLocalRegistry(workspaceRoot),
    detail: 'package-lock.json still holds verdaccio and its chain, which no manifest declares; npm audit reports high advisories (braces has no patched release) on packages nothing uses',
    remedy: 'run `mnci upgrade`, which removes it, then commit package-lock.json',
  }
}

/**
 * Collects every doctor finding for a workspace.
 *
 * @remarks
 * Exported separately from {@link runDoctor} so the checks can be asserted
 * directly, without capturing console output or an exit code.
 *
 * Every check corresponds to an invariant that has actually been violated in
 * practice, in this repo or in a workspace it generated — none are hypothetical.
 * That is the bar for adding one: a check nobody has ever needed is noise that
 * trains people to ignore the output.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The findings, in report order.
 * @throws Error when `workspaceRoot` has no `nx.json`.
 * @typeParam None - this function has no generic type parameters.
 */
export function collectFindings (workspaceRoot: string): Finding[] {
  const nxJsonPath = join(workspaceRoot, 'nx.json')
  if (!fileExists(nxJsonPath)) {
    throw new Error(
      `No nx.json found in ${workspaceRoot} — run 'mnci doctor' from the workspace root.`,
    )
  }
  const nxJson = readJson<{
    plugins?: unknown[]
    mnci?:    { registry?: RegistryConfig; scope?: string }
    release?: { version?: { preserveMatchingDependencyRanges?: unknown }, releaseTag?: { pattern?: string } }
  }>(nxJsonPath)

  return [
    ...checkEslintConfigs(workspaceRoot),
    checkNoRetiredFormatter(workspaceRoot),
    checkEslintPlugin(nxJson),
    checkResolvedEslint(workspaceRoot),
    checkNpmrc(workspaceRoot, nxJson.mnci?.registry, nxJson.mnci?.scope),
    checkNpmrcCredentialResolves(workspaceRoot),
    checkNpmAuthMatchesPipeline(workspaceRoot, nxJson.mnci?.registry),
    checkNoRootRuntimeDependencies(workspaceRoot),
    ...checkRollupSourceMaps(workspaceRoot),
    ...checkDeclarationSpecifiers(workspaceRoot),
    ...checkVersionActions(workspaceRoot),
    ...checkTargetFilesExist(workspaceRoot),
    checkSync(workspaceRoot),
    checkGoPluginRegistered(workspaceRoot),
    checkGoWorkInSync(workspaceRoot),
    ...checkNativeApps(workspaceRoot),
    ...checkPipelinePhases(workspaceRoot),
    ...checkNativeBuildConfig(workspaceRoot),
    checkDependencyRangesNotPreserved(nxJson),
    checkLockfileHasNoLocalRegistry(workspaceRoot),
    checkReleaseTagsResolve(workspaceRoot, nxJson),
    checkTagsMatchRegistry(workspaceRoot),
    checkReactAppOutput(workspaceRoot),
  ].filter((finding): finding is Finding => finding !== undefined)
}

/**
 * Flags of `mnci doctor`.
 *
 * @remarks
 * `mnci doctor` has only the one flag.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DoctorOptions {
  /** Print the findings as one JSON document, for an editor or a script. */
  json?: boolean
}

/**
 * Reports on the mnci invariants a workspace is supposed to uphold.
 *
 * @remarks
 * Read-only by design: it never edits the workspace, so it is safe to run
 * anywhere, and every failing finding names the command that fixes it (usually
 * `mnci upgrade`) rather than fixing it silently.
 *
 * Exits non-zero when anything failed, so it works as a CI step as well as a
 * local command. Sets `process.exitCode` rather than calling `process.exit`, so
 * output is never truncated.
 *
 * With `json`, stdout is one document (`{ findings, passed, failed }`, each finding carrying
 * its `remedy`) and nothing else; the exit code is the same.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Error when `workspaceRoot` is not an Nx workspace.
 * @typeParam None - this function has no generic type parameters.
 */
export function runDoctor (workspaceRoot: string, options: DoctorOptions = {}): void {
  const findings = collectFindings(workspaceRoot)
  const failed = findings.filter(finding => !finding.ok)

  if (options.json === true) {
    printJson({ findings, passed: findings.length - failed.length, failed: failed.length })
    if (failed.length > 0) {
      process.exitCode = 1
    }

    return
  }

  for (const finding of findings) {
    if (finding.ok && finding.warning === true) {
      logger.warn(`${finding.check} — ${finding.detail ?? ''}`)
      if (finding.remedy) {
        logger.info(`    to change it: ${finding.remedy}`)
      }
    } else if (finding.ok) {
      logger.success(finding.check)
    } else {
      logger.error(`${finding.check} — ${finding.detail ?? 'failed'}`)
      if (finding.remedy) {
        logger.info(`    fix: ${finding.remedy}`)
      }
    }
  }

  if (failed.length === 0) {
    logger.success(`All ${findings.length} checks passed.`)

    return
  }
  logger.error(`${failed.length} of ${findings.length} checks failed.`)
  process.exitCode = 1
}
