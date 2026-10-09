<p align="center">
  <img src="../../assets/logo.svg" alt="mnci" width="160">
</p>

# @mnci/cli

> A **thin CLI over what Nx already ships**: an opinionated one-command Nx
> monorepo with automatic commit-message versioning, instead of hand-rolling
> templates, configs and CI engines.

## The thesis

Most of what a monorepo tool needs to hand-roll — a template engine, a shared
config package, a dependency-injection step for published
packages, a doctor/drift-sync system to keep it all consistent — already has a
first-party (or established community) Nx equivalent:

| Hand-rolled elsewhere                      | This CLI uses instead                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Template engine + per-project config files | `create-nx-workspace --preset=ts` + `nx g` plugin generators                  |
| A shared toolchain package for configs     | The configs the Nx generators emit (one root ESLint/tsconfig)                 |
| A custom multi-step CI engine              | `nx affected -t lint,typecheck,test,build` + `nx release` (~60-line pipeline) |
| A dist-package dependency injector         | `nx release` updates dependent versions natively                              |
| Hand-written Azure Function templates      | `@nx/node:application` (plain Node app) + a thin Azure Functions v4 overlay   |
| doctor/drift sync of tool-owned files      | Nothing to drift: this CLI owns 5 small files, Nx owns the rest               |

## How this package is organised

Source is arranged in **vertical slices**: one folder per outcome, each with an
`index.ts` that is its whole public API. A sibling is reached only through that
barrel, never by a path into its files, and a file's suffix says what role it
plays (`.use-case`, `.client`, `.repository`, `.algorithm`, `.validator`,
`.handler`). Tests sit beside what they test.

```
src/
  main.ts                     the CLI transport — decodes argv, calls one use case
  workspace-overlay/          the config files mnci owns and rewrites
  workspace-creation/         mnci new
  interactive-wizard/         bare mnci: every command and option, asked from the command's own description
  repository-adoption/        mnci adopt — the command, which runs the step slices below
  adoption-report/            what adopt reads from a repository and the blockers and warnings it judges
  toolchain-adoption/         adopt --toolchain: retired tooling gone, one Nx version, an audit that passes
  kind-adoption/              adopt --kinds: each project's mnci kind as a type tag
  dependency-adoption/        adopt --dependencies: root runtime dependencies into the projects that import them
  clean-working-tree/         the git precondition every step that changes files shares
  release-tag-lineage/        release tags kept reachable across a rename; doctor, upgrade and adopt all use it
  nx-agent-scaffolding/       Nx's AI-agent files removed entry by entry, never a team's own files beside them
  lockfile-completion/        package-lock.json completed by the npm CI installs, so an older npm's lockfile passes npm ci
  go-module-release/          a go-lib released by nested-module tag (<dir>/vX.Y.Z) from the release phase
  esm-conversion/             a generated Node app made an ES module (add --esm)
  dev-servers/                mnci dev: several projects started together
  workspace-presets/          mnci new --preset: a whole shape of workspace, wired
  workspace-upgrade/          mnci upgrade
  workspace-diagnostics/      mnci doctor
  project-scaffolding/        mnci add — one use case per kind, plus post-generation repairs
  rollup-library/             what a rollup-bundled library needs repaired to build, type and publish
  dependency-management/      mnci sync / mnci up, and the manifest + registry + semver machinery
  tool-versions/              which tools mnci pins have a newer release, for the tooling section of mnci up
  nx-workspace/               runs the Nx and npm CLIs, always via an argv array
  terminal/                   prompts in, coloured status out
  file-system/                JSON, JSONC workspace files, ensured writes
  project-name/               name validation
  cli-version/                the update check
```

**Written exception: `src/project-scaffolding/` is over the 12-file review threshold.**
- *Rule waived:* the folder-size review point (it holds a dispatcher, one file per project kind, and
  `post-generation.use-case.ts`).
- *Constraint:* every kind calls `registerProjectCommands` (and uses its `ProjectCommands` type) from
  `post-generation.use-case.ts`. A kind moved to a slice of its own would import that back from
  `project-scaffolding` while `project-scaffolding` imports the kind: a cycle, type-only imports included.
- *Owner:* the repository owner. *Temporary:* it ends when `registerProjectCommands`, `ProjectCommands` and the
  helpers they use move out of `post-generation.use-case.ts` into a `project-commands/` slice; each kind
  (`container` first) can then move into a slice of its own. Splitting a file this size is its own change and needs a
  yes, so it is recorded here and not done as a side effect. The ESM conversion had no such dependency and is
  already its own slice (`esm-conversion/`).

The dependency graph is acyclic and flows one way: `main` → the command
slices → the infrastructure slices → `file-system` as a leaf. That is checked,
not assumed — and now enforced: the root `eslint.config.mjs` turns on
`@mnci/eslint-config`'s `verticalSlices` rules for `packages/cli/src`, so a
deep sibling import, a file without a role suffix, a nested subfeature or a
cycle between slices fails `npm run lint` rather than needing someone to
re-run the checks by hand. It is scoped to this package deliberately; the
config file says which packages were measured and why they are excluded.

### Exceptions, and when they go away

Two places hold more than the one responsibility their name claims, and are
named here because the next reader deserves to know before opening them:

| Path | Rule waived | Why, and removal condition |
|---|---|---|
| `workspace-overlay/overlay.use-case.ts` | one responsibility per file | ~5k lines covering CI YAML for two providers (including the native-app job), `.npmrc`, `nuget.config`, the VS Code workspace, release config and the CI guard scripts. Splitting it is a decomposition, not a move, so it was deliberately kept out of the change that created these slices. **Temporary** — removed when that decomposition lands. |
| `rollup-library/repair-rollup-config.use-case.spec.ts` | a test takes its subject's basename | It also holds the `withUpgradedDeclarationSpecifierPlugin` describe, whose subject is `rollup-config.algorithm.ts`. That transform shares three fixtures with the repairs that apply it (`OLD_DTS_PLUGIN_CONFIG`, `EXTENSION_ONLY_DTS_PLUGIN_CONFIG`, `loadWriteBundle`), and duplicating them across two spec files is the worse trade. **Permanent** unless those fixtures stop being shared. |

`rollup-library/` exists because of the own-the-concept rule. Its contents used
to live in `project-scaffolding`, which meant `workspace-diagnostics` and
`workspace-upgrade` depended on the scaffolding slice **only** to reach repair
helpers — they have no interest in adding a project. The concept now sits in its
own slice that depends on nothing above it (`file-system` alone), and all three
consumers point at it.

## Commands (deliberately few)

```sh
mnci new my-repo            # create a monorepo (prompts scope + registry)
mnci new my-repo --yes --registry npm --scope @my
mnci new my-repo --yes --registry npm --scope @my --nx-cloud  # opt in to Nx Cloud
mnci new --into .           # ...or bootstrap into a clone that already exists

cd my-repo
mnci add react-app web         # @nx/react (Vite + Jest)
mnci add node-app svc          # @nx/node (plain Node app, esbuild)
mnci add node-app api --framework express  # ...or fastify | koa | nest
mnci add npm-lib core --empty             # slice skeleton only, no sample (also internal-lib, react-lib, react-internal-lib)
mnci add node-function-app api # @nx/node + an Azure Functions v4 overlay
mnci add npm-lib sdk           # @nx/js publishable lib -> packages/
mnci add internal-lib utils    # @nx/js private lib -> libs/
mnci add react-lib ui          # @nx/react publishable component lib -> packages/
mnci add react-internal-lib design  # @nx/react private component lib -> libs/

# Python (@mnci/nx-python-pip — pip + Ruff + pytest + PyPA build/twine, no uv)
mnci add python-app svc            # app -> apps/ (wheel, zipped into the drop)
mnci add python-function-app fn    # Azure Functions (Python v2) -> apps/
mnci add python-lib shared         # publishable -> python-packages/ (twine upload)
mnci add python-internal-lib core  # private shared lib -> libs/
mnci add python-vendor shared --lib core  # wire core's module into shared's built wheel

# Go (@nx-go/nx-go — multi-module: one go.mod per project + a root go.work, golangci-lint + go test)
mnci add go-app api            # executable -> apps/ (binary, zipped into the drop)
mnci add go-app cli --release  # ...released: tag + per-platform zips on the GitHub Release
mnci add go-app tray --cgo     # needs a C toolchain: built on a runner of each OS
mnci add go-app site --web web # embeds and serves the React app apps/web in one binary
mnci add go-function-app fn    # serverless handler -> apps/
mnci add go-lib core           # publishable (by git tag) -> packages/
mnci add go-internal-lib util  # private shared package -> libs/

# Flutter (@mnci/nx-flutter — one root pubspec.yaml pub workspace, analyze + test)
mnci add flutter-app hello         # Flutter web app -> apps/ (bundle, zipped into the drop)
mnci add flutter-lib shared        # publishable (by git tag) -> packages/
mnci add flutter-internal-lib core # private shared package -> libs/

# VS Code extensions (@nx/node + vsce — bundled, packaged per platform, published by nx release)
mnci add vscode-extension editor                      # one universal .vsix -> dist/drop/
mnci add vscode-extension editor --sidecar api        # one .vsix per platform, go-app api's binary in bin/
mnci add vscode-extension editor --publisher acme     # Marketplace publisher (default: the scope without @)

mnci upgrade                  # re-apply the latest overlay (see below)
mnci upgrade --agent windows-latest   # ...with an explicit override

mnci doctor                   # check this workspace's invariants (read-only)

mnci ci verify                # the pipeline's verify phase, run here: see `mnci ci` below

mnci sync                     # converge dependency ranges + nx sync (TS project refs)
mnci sync --check             # ...report and exit non-zero, writing nothing

mnci up                       # what has a newer release, grouped; pick what to update
mnci up --check               # ...report only (the default when output is piped)

mnci i -w web left-pad        # add a dep to ONE project, using its toolchain (alias: mnci install)
mnci i -w api github.com/x/y  # ...go get in the Go module; dotnet/flutter/pip all dispatched the same way
mnci i -w ui -w web react     # ...-w repeats, to add to several projects at once
mnci i -w svc jest -D         # ...--save-dev where the ecosystem has a dev-dependency notion
mnci i                        # no -w: install/restore the whole workspace (the one-shot bootstrap)
```

## Where a dependency belongs: root vs project

One rule, and it is the same in every language mnci supports:

> **Shared development and tool packages live at the root. Runtime dependencies
> belong to the package that imports them.**

|          | Runtime deps declared in                                             | What the root file holds                                              |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| npm      | each project's `package.json`                                        | `package.json` — scripts, devDependencies, `overrides` (root-only by npm's rules) |
| pip      | each project's `pyproject.toml` (a function app: its `requirements.txt`) | `requirements-dev.txt` — the shared toolchain, nothing else            |
| pub      | each member's `pubspec.yaml`                                         | `pubspec.yaml` — the member list and an SDK floor, **no** dependency blocks |
| go       | each project's own `go.mod` (multi-module)                           | `go.work` — the `use` list only; mnci owns it, no requirements         |

**Go follows the same rule as everything else** (MoNecromanCI/MoNecromanCi#289). Each
project has its own `go.mod` with a fetchable module path
(`<host>/<org>/<repo>/<dir>`, derived from the git origin), tied together by a
root `go.work` that mnci owns. That is what lets `mnci i -w <go-project> <pkg>`
`go get` into exactly that module. The one hazard it introduces —
a stale `use` entry whose directory is gone makes `go list -m` fail and breaks
the whole Nx project graph — is caught by `mnci doctor`, which fails on it and
names the line to remove.

### Why hoisting a runtime dependency to the root is a bug, not a tidy-up

It looks like centralisation and it is not. Two independent reasons:

1. **The root manifest is `private` and never published.** A runtime dependency
   declared there reaches no consumer of any package; an installed `@scope/lib`
   simply fails to resolve it.
2. **`@nx/rollup` externalises exactly what a project's OWN manifest declares.**
   Pull a dependency out of `packages/thing/package.json` and rollup stops
   treating it as external — it **inlines a private copy into the bundle**.
   Measured on a real generated workspace: moving `axios` out of one package's
   manifest took its published bundle from 14.5 KB to 832 KB, silently.

Two things catch this, from opposite directions. `@nx/dependency-checks` (in the
root ESLint config, so it runs as part of `lint`) fails the project whose import
is now undeclared, and `mnci doctor` fails the root that took it.

## Debugging: breakpoints in the TypeScript, not the built JavaScript

A publishable library is bundled by `@nx/rollup`, so what runs is `dist/*.js`.
A breakpoint in the `.ts` binds only if the build emitted a source map that
points back at real files. Three separate things had to be fixed for that to be
true, and a generated workspace now gets all three:

| | The default | What mnci writes |
| --- | --- | --- |
| `sourceMap` | unset, so **no `.js.map` at all** | `true`, in `withNx`'s first argument |
| `compiler` | `'swc'`, hardcoded by `@nx/js:lib` | `'babel'` — see below |
| `sources` paths | OS-native, one parent segment too many | repaired by `sourcemapPathTransform` |

Each one alone leaves breakpoints grey, and none of them reports an error.

**`sourceMap` has to go in the first argument.** The obvious spot is
`output: { sourcemap: true }` in the second — the generator's own placeholder
comment even suggests it — and it silently does nothing: `withNx` spreads your
`output` and *then* assigns `sourcemap: options.sourceMap`, so its own undefined
value always wins.

**The compiler swap is not a preference.** `@nx/rollup`'s swc plugin calls
swc's `transform()` without `sourceMaps`, so swc returns no map, the rollup
chain breaks, and the map comes out valid-looking and **empty** — `sources: []`.
Measured on a real package: swc gave 0 sources, babel gave 9. Revert the swap
once Nx passes `sourceMaps` through; issue #308 has the one-line upstream fix.

Re-measured against the exact toolchain `mnci new` pins today (Nx 23.2.0,
`@swc/core` 1.15.8): `@nx/rollup`'s swc plugin still does **not** pass
`sourceMaps` to `transform()` — read straight from the installed package, not
assumed — yet a real build with `compiler: 'swc'` left unmodified now emits a
map with real `sources`/`sourcesContent`, and tracing a generated position
through it with `@jridgewell/trace-mapping` resolves to the correct original
line and column. So the empty-map failure this section exists to route around
did not reproduce on the current pinned versions, even though the documented
root cause (the plugin's own missing `sourceMaps` option) is still there
verbatim. That is not the revert condition stated above — nothing upstream
changed the call this section is about — so the swap stays in place as a
safety net rather than being removed on an unexplained, unpinned-by-upstream
behavior change that a future `@swc/core` patch could revert without notice.
**A real, separate bug in the swap itself was found and fixed**, independent
of the above: it matched `compiler: 'swc'` with a plain string, one space
after the colon. `@stylistic/key-spacing` (aligned on value) — which
`eslint --fix` applies to every mnci-generated file — pads that column out to
whatever the object's longest key is, so on any config reached after even one
lint pass (most concretely: `mnci upgrade` repairing a project whose `add`
partially failed) the literal silently stopped matching and the swap
silently no-op'd, while `sourceMap: true` and `sourcemapPathTransform` — added
by separate, whitespace-tolerant repairs — went in regardless. `mnci doctor`'s
check did not catch it either, since it only verifies the flag, not the
compiler. Confirmed end to end and fixed with the same whitespace-tolerant
approach `sourceMap: true`'s own guard already used.

**The paths are wrong twice over.** rollup hands `sourcemapPathTransform` a
path like `..\..\src\index.ts` for a map in `dist/` — one parent segment too
many, so it resolves above the project to a file that does not exist, and
back-slashed, which is invalid in a sourcemap `sources` entry on every platform
(a `sources` entry is URL-style — the same bug class as the declaration stub).
Both are repaired, by collapsing the parent-segment run rather than stripping a
fixed prefix, so it cannot go stale at another nesting depth.

**Maps are built always and published never.** `!**/*.js.map` joins `files`, so
`npm run <lib>:build` is debuggable while the tarball stays lean — the same
trade already made for `.d.ts.map`. There is deliberately no dev-build flag: a
build you have to remember to run differently is one you will not have run at
the moment you need it.

`mnci doctor` reports any rollup config missing this, and `mnci upgrade` sweeps
`packages/*` and `libs/*` to add it — a rollup config is written once at `add`
time, so a workspace generated earlier would never fix itself otherwise. The
sweep is idempotent.

## `mnci sync`: making every project agree

`nx sync` runs the workspace's **sync generators**, and the only one a generated
workspace registers is `@nx/js:typescript-sync` — it reconciles TypeScript project
references and has no opinion whatsoever about dependency versions. And npm has no
`catalog:`, pnpm's one-version-per-workspace mechanism, so keeping two projects on
the same range is a convention nothing enforces.

`mnci sync` is both halves:

1. Every external package declared at more than one version converges on one spec.
2. `nx sync` then reconciles the TypeScript project references.

The winning spec is the one matching what is actually **resolved** —
`node_modules` for npm, `pubspec.lock` for pub, the interpreter for pip. That is
the same source `@nx/dependency-checks` pins a drifted range to when it
auto-fixes, so the command and the lint rule converge on one answer instead of
overwriting each other. With nothing installed, the highest declared range wins
instead, and the report says which rule was applied.

It keeps the range operator the majority of sites already use, so a workspace
that pins exactly stays pinned.

**Three things it deliberately never touches:**

- **Peer ranges.** `>=21.0.0` on `@nx/devkit` is a *compatibility declaration*,
  not a version choice — narrowing it to the 23.x you happen to resolve drops two
  majors of consumers. The first run of this command against mnci's own repo
  reported six findings, five of which were exactly that mistake.
- **The workspace's own projects.** An internal `@scope/lib` is symlinked and
  versioned by `nx release`; its loose range is what lets both the link and the
  tag satisfy it.
- **A spec whose shape it cannot safely edit** — a `git:`/`path:`/URL target, a
  `workspace:` protocol, an `npm:pkg@range` alias, a pub `git:` map. Those are
  reported as a warning and left alone.

**Go is read but not converged, and says so rather than passing silently.** Every Go project has its
own `go.mod`, so two of them can require different versions of one module. But under the root `go.work` the
workspace builds with the highest version any of them requires (minimal version selection), so a lower
declaration does not ship a second copy; the fix for a stale one is `mnci up`, which upgrades it with
`go get`. An adopted flat repository (one root `go.mod`, no `go.work`) is read the same way.

`--check` reports and exits non-zero without writing anything, so it works as a CI
step. `--ecosystem npm|pip|pub|go` narrows the run.

## `mnci up`: what has a newer release, and who is using it

Modelled on `npm-check -u` — the same four sections in the same order, the same
interactive multiselect — with one addition that `npm-check` cannot give you in a
monorepo: **every project declaring the package**.

```
Minor Update  New backwards-compatible features.
  @nx/devkit                 devDep/peerDep   23.1.1  ›  23.2.0  (root), packages/nx-python-pip, packages/nx-flutter
  @typescript-eslint/parser  dep/devDep        8.68.0  ›  8.69.0  packages/eslint-config, packages/az-durable
```

That column is the point. It is what tells you an upgrade touches three projects
before you pick it, and picking one rewrites **every** declaration of it — which
is what stops `mnci up` from creating the drift `mnci sync` then has to repair.

Latest versions come from each ecosystem's own tooling, never a hand-rolled HTTP
call: `npm view` (so a scoped Azure Artifacts feed and its `.npmrc` credentials
just work), `pip index versions`, one `go list -m -u -json all`, one
`flutter pub outdated --json`. An ecosystem whose toolchain is absent is reported
as a loud `SKIPPED`, never quietly dropped.

The same three exclusions as `mnci sync` apply, plus two more that only matter
here: an **indirect Go module** (`go mod tidy` owns those) and an **aliased
install**, where the manifest key names a different package than the one on disk.
The alias case is not hypothetical — mnci's own root manifest pins the dual
TypeScript compiler as `typescript: npm:@typescript/typescript6@^6.0.2`, and the
first run of this command offered "typescript 6.0.2 › 7.0.2", which is real
TypeScript's version, about a package the workspace does not have.

`mnci up` also opens with a short **tooling** section for the tools mnci itself pins and installs (the
`golangci-lint` linter, Node, npm, and the Go, .NET and Flutter SDKs). They are not requirements of any manifest, so
they are asked of their own release sources and shown only when a newer release exists, compared at the pin's
precision: pinned Node `24` is behind only by a higher major, never by a patch of 24. It is informational. Each version
is one constant in mnci's source, so the remedy is an mnci release, not a change to your workspace. A source that cannot
be reached is skipped, and `--ecosystem` leaves the section out.

A selected Go module is upgraded with `go get <module>@<version>`, never by
editing `go.mod` — that file is the toolchain's to write. It runs inside each module that declares the
package (a multi-module workspace has no root module to run it in), and the reinstall is `go work sync`
(`go mod tidy` for a flat repository).

Flags: `--check` (report only; also the automatic behaviour when stdout is not a
TTY, so a piped or CI run reports instead of hanging on a prompt), `-y/--yes`
(take everything), `--ecosystem`, and `--no-install` (edit the manifests but skip
the reinstall).

## `mnci ci`: the pipeline's phases, as a command

`mnci ci verify` runs the pipeline's verify phase on your machine: `nx sync:check`, then
every project (or, when a pull request's target branch is set, only the projects affected
since the merge-base with it) through `lint`, `typecheck`, `test` and `build`. It exits with
the failing command's own status, so it can stand in for the pipeline's step.

It is not a shortcut for those Nx targets, and the CLI still has no wrapper for `nx test`.
It is the pipeline's own logic, which until now lived as a `node -e` one-liner inside the
generated YAML, ported to tested code, so a laptop and a pipeline run the same thing. The
design (one `npx mnci ci` call in the pipeline, with room for your own steps around it) is
tracked in #269, and this is its first phase: **the generated pipelines do not call it yet**
and are unchanged, so nothing about an existing workspace changes. Phases follow as their
guards are ported.

- **Same scoping as the guard.** No pull-request target means every project, so a push to
  main verifies in full. A pull request verifies what is affected since the merge-base with
  `origin/<target>`, fetching the target once if that ref is missing, and falls back to every
  project when no merge-base can be found, since a run that verifies too little still reports
  green. The target comes from `GITHUB_BASE_REF` or `SYSTEM_PULLREQUEST_TARGETBRANCH`, so to
  reproduce a pull request run locally, set one: `GITHUB_BASE_REF=main mnci ci verify`.
- **Native (cgo) apps are left out**, as in the pipeline, since one agent cannot build them.
- **Log groups.** Under GitHub Actions and Azure Pipelines each part is a collapsible group
  (`::group::`, `##[group]`); locally it is a plain heading.
- **Checked against the guard it replaces.** An integration spec runs the inline guard and
  this command against the same real git repository, with a recording stand-in for `npx`,
  across a push, a pull request, Azure's `refs/heads/` form, a missing `origin/<target>` and
  an unresolvable one, and requires the same Nx commands in each.

## `mnci doctor`: checking the invariants actually hold

Read-only — it never edits the workspace. Every failing finding names the command
that fixes it (usually `mnci upgrade`), and it exits non-zero when anything failed,
so it works as a CI step as well as a local command.

Every check corresponds to an invariant that has **actually** been violated, in
this repo or in a workspace it generated. None are hypothetical; a check nobody has
ever needed is noise that trains people to ignore the output.

| Check                                                   | The failure it catches                                                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly one root ESLint config, and no per-project ones | The config fragmenting — every `@nx/*` generator writes one, so each project ends up linting against whichever config sits nearest                  |
| `@nx/eslint/plugin` registered in `nx.json`             | Without it `npm run lint` exits 0 while linting nothing                                                                                             |
| The **resolved** `eslint` major                         | A declared range and an installed version are different things — manifests once said `^10` while the pin said 9                                     |
| `.npmrc` matches the recorded registry                  | The two registry kinds get different files; an Azure workspace also needs its scope routed                                                          |
| `versionActions` on publishable Dart/Python packages    | Its absence aborts `nx release` for the **whole** workspace, not just that project                                                                  |
| `nx sync:check`                                         | A stale TypeScript project reference that was never committed                                                                                       |
| No runtime dependency in the root manifest              | A dependency hoisted to the root, which reaches no consumer (the root is private) and makes `@nx/rollup` inline a private copy into the package that imports it — 14.5 KB to 832 KB on a real measurement. See "Where a dependency belongs" above |
| Source maps enabled in every rollup config              | A build that emits no `.js.map`, so every breakpoint in a `.ts` file stays grey and unbound with nothing reporting why. A rollup config is written once at `add` time, so an older workspace never fixes itself — `mnci upgrade` sweeps them |
| No retired formatter is still configured                | A leftover `.prettierrc*`, `.oxfmtrc.json` or `oxlint.config.ts`, or a `prettier`/`oxlint`/`oxfmt` devDependency, runs from no command line — which is what makes it dangerous, since an editor extension still resolves it and reformats on save, undoing Standard after every gate has passed |

Everything else is plain Nx, surfaced as a small curated set of root scripts —
each a single cross-platform command:

| Script                    | Runs                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`           | `nx run-many -t build`                                                                                                                |
| `npm run lint`            | `nx run-many -t lint`                                                                                                                 |
| `npm run test`            | `nx run-many -t test`                                                                                                                 |
| `npm run typecheck`       | `nx run-many -t typecheck` — its own script because a bundler-built project's `build` strips types without reading them               |
| `npm run affected`        | `nx affected -t lint,typecheck,test,build` (vs `main`)                                                                                |
| `npm run graph`           | `nx graph`                                                                                                                            |
| `npm run release:preview` | `nx release --dry-run`                                                                                                                |
| `npm run python:install`  | fixed Python toolchain (ruff/pytest/build/twine) + editable-install every Python project — the same two guards CI runs, for local dev |
| `prepare`                 | `husky` (commit-msg lint hook)                                                                                                        |

## Every `add` also wires local-dev commands

Every `mnci add` (and the inline `internal-lib` case) finishes by calling
`registerProjectCommands` (`project-scaffolding/post-generation.use-case.ts`), which writes up to three
root `package.json` scripts for the project just added:

| Script         | Runs                                       | When it's added                                                                                                                                    |
| -------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<name>:build` | `nx run <name>:build`                      | the kind has a `build` target (not every kind does — a private lib with nothing to publish, or a Python function app deployed as source, has none) |
| `<name>:qa`    | `nx run <name>:lint && nx run <name>:test` | always — every kind has both                                                                                                                       |
| `<name>:start` | the kind's real local-dev command          | only kinds with a genuine dev-server story — never a library                                                                                       |

The same three (when present) are appended as VS Code Tasks into the
workspace's `<workspace-name>.code-workspace` file, so they also show up
under **Terminal → Run Task** / the Command Palette — `build`/`qa` grouped
accordingly, `start` marked `isBackground` since it runs a process that
doesn't exit on its own. Re-running `add` for the same project name
overwrites its own scripts/tasks rather than duplicating them.

#### Run and Debug: the `launch` section

Tasks are reachable **only** through Terminal → Run Task. The **Run and Debug**
panel reads a separate `launch` section, so a workspace with tasks alone offers
nothing in the dropdown people actually open. Every generated workspace therefore
also gets four launch configurations, one per verify target:

| configuration | runs |
| --- | --- |
| `mnci: build` | `npm run build` |
| `mnci: test` | `npm run test` |
| `mnci: lint` | `npm run lint` |
| `mnci: typecheck` | `npm run typecheck` |

Every project that has a `start` script (`mnci add` of an app kind) also gets its own configuration,
`mnci: <project> start`, which runs `npm run <project>:start`. These sit in a separate `mnci projects` group
in the dropdown.

Three details are load-bearing rather than incidental:

- **`type: node-terminal`, not `node`.** `nx run-many` executes every target in a
  **child** process. A plain `node` launch attaches to the Nx parent alone, so a
  breakpoint inside a spec never binds; `node-terminal` runs the command in VS
  Code's JS Debug Terminal, which instruments children as they spawn. It also avoids
  a second trap — a `node` launch defaults to `internalConsole`, which renders none
  of Nx's progress output, so a build there looks like it has hung.
- **They drive `npm run <script>`, never a path into `node_modules`.** The obvious
  `program: node_modules/nx/bin/nx.js` is wrong: Nx ships its bin at
  `dist/bin/nx.js`, and that path moves between versions. Driving the root script
  tracks whatever it does, so a change to the scripts reaches these for free.
- **`cwd` is `${workspaceFolder:<name>}`, scoped by folder name.** A bare
  `${workspaceFolder}` is ambiguous the moment a second folder joins the workspace,
  and VS Code then refuses to resolve it — breaking all four at once.

Your own configurations are safe: `mnci upgrade` replaces only the entries named
`mnci: *` and carries every other one through untouched.

`:start` resolves differently per kind — an existing generator target where
one already exists, a small `nx:run-commands` target mnci writes where none
did:

| Kind(s)                                    | `:start` runs                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `react-app`, `node-app`                    | `nx run <name>:serve` — the generator's own inferred dev-server target                                                                |
| `node-function-app`, `python-function-app` | `nx run <name>:start` → `func start` (Azure Functions Core Tools, install separately — never a prerequisite for `add` itself)         |
| `python-app`                               | `nx run <name>:start` → `python3 main.py` — mnci writes a runnable `main.py`, since the plugin's own sample module has no entry point |
| `go-app`                                   | `nx run <name>:start` → `go run .`                                                                                                    |
| `flutter-app`                              | `nx run <name>:start` → `flutter run -d chrome` (web is the only platform this plugin builds for)                                     |
| every library, `go-function-app`           | no `:start` at all — see below                                                                                                        |

**`go-function-app` is a known gap, not an oversight**: unlike the Node and
Python function-app kinds, it writes no `host.json`/custom-handler config, so
there is nothing for `func start` to attach to. Shipping a `:start` script
that would just fail felt worse than being upfront that it doesn't exist yet.

## What `new` actually does

1. `npx create-nx-workspace@latest <name> --preset=ts` — npm workspaces +
   TypeScript project references. Libraries get **no `project.json`**; targets
   are inferred from each project's tsconfig/package.json.
2. Patches `nx.json` with the release opinion (the only config Nx has no
   default for): independent versioning from **conventional commits**,
   `{projectName}@{version}` tags, **tag-only git** (`commit: false`) — nothing
   is ever pushed to `main`; future runs resolve versions from tag names. Also
   fills in `namedInputs.sharedGlobals` with the root config files
   (`eslint.config.mjs`, `eslint.config.mnci.mjs`, `tsconfig.base.json`,
   `package.json`), without which
   `nx affected` on a pull request is blind to them: they live in no project, so
   changing one marked only the root pseudo-project — which has no
   lint/typecheck/test/build target — and the affected-scoped verify step ran
   nothing at all while reporting green.
3. Writes **two** ESLint files, and only one of them is mnci's:
   `eslint.config.mnci.mjs` holds the whole linting opinion (one import from
   `@mnci/eslint-config`, plus a commented inventory naming every config block)
   and is rewritten on every upgrade; `eslint.config.mjs` is the file ESLint
   actually loads, imports that one, holds **your** blocks, and is written once
   and then never touched again. See **Your half of the ESLint config** below.
   There is no formatter config, because ESLint is the formatter. Also writes
   `.npmrc` (publish auth — see **Publish auth** below),
   `commitlint.config.mjs`, a husky `commit-msg` hook, the chosen CI provider's
   pipeline file(s)
   (`azure-pipelines.yml` and/or `.github/workflows/ci.yml`, `--ci`, default
   `azure`; `github`/`both` also gets `.github/dependabot.yml` — weekly
   dependency-update PRs), a `<workspace-name>.code-workspace` file (VS Code
   workspace configuration with folder structure, ESLint settings,
   recommended extensions, and an empty `tasks` array that `mnci add` fills in
   per project — see below — open it in VS Code via `File > Open Workspace
from File`), and the curated root scripts.
4. Installs the chosen **stack** (see below), `husky` + `@commitlint/*` for
   real, so versions resolve at generation time.

## A whole shape in one step (`mnci new --preset`)

Everything else in mnci is per project. `mnci new my-shop --preset web-api` also scaffolds a wired-together shape, so the
result is a starting point that already runs rather than three projects to connect:

| Preset | Adds | Wiring |
|---|---|---|
| `web-api` | `libs/shared` (an internal library), `apps/api` (Express) and `apps/web` (React) | the API answers `GET /api/greeting` with the shared library's `greet`; the frontend asks that route and types the answer with the shared `Greeting`; both declare `@<scope>/shared`; Vite forwards `/api` to the API in development |

Each project is added through `mnci add`, so it is exactly what `add` makes, and the preset then edits them into one shape:
the API and the frontend drop their own copy of the sample use case and contract (the library owns them now), each gets a
spec that matches (written without a mock library, so it runs under Jest or Vitest), and one install, one `nx sync` and one
format finish it. `mnci dev web api` starts both servers, and asking the frontend's origin for `/api/greeting` returns the
API's answer through the proxy.

A misspelt preset is refused before the workspace is generated, and the wiring edits fail with the file named, not
silently, if a generator's output ever stops having the text they change. A preset is a starting point to edit: delete what
you do not need. New presets are an entry in `workspace-presets/preset-catalog.config.ts` plus their wiring.

The `web-api preset` e2e section generates one and checks lint, typecheck, test and build for all three projects, the
specs under Vitest, and the proxied request while both servers run.

## Starting projects together (`mnci dev`)

`<name>:start` starts one project. `mnci dev web api` starts several at once, the usual case being a frontend and the
API it calls: `mnci dev` with no names asks which (or `--all` starts every one that can be started, and `--dry-run`
prints what would run). A script with no terminal must name them, and a name that is a library, or a typo, is refused
with the list that can be started.

Each project runs the Nx target its own start script names. That is not always `start`: a React or Node app's
`<name>:start` runs its `serve` target, a Go app's runs `start`, so `nx run-many -t start` would find nothing for the
first two. Output is shown with a `[project]` prefix. The projects run until the **first one stops**; then the others
are stopped too, so a crashed API does not leave a frontend quietly talking to nothing, and Ctrl+C stops them all
(`taskkill /T` on Windows, the process group elsewhere). The command exits with the status of the first to stop.

The `dev up` e2e section starts a real Vite server and an Express API together, talks to both, and checks that stopping
the command frees both ports.

## Container images (`mnci add container <name> --app <app>`)

`container` is a kind that wraps an app you already have, so the app keeps its own kind and the image is a project
of its own beside it: `mnci add container api-image --app api --port 3000`. It writes `apps/<name>/` with a
`Dockerfile`, a `Dockerfile.dockerignore`, a `files/` directory for anything the image copies from beside the build
context, and a manifest tagged `type:container` with two targets. `image` builds `<name>:<VERSION>` and
`<name>:latest` after the app's own output target (`VERSION` is `dev` when unset, as in the Go builds), and `start`
runs the image, publishing the port. The project declares the app as an implicit dependency, so `nx affected`
knows a change to the app affects its image. `npm run <name>:image` and `<name>:start` are registered; `:qa` builds
the image.

One recipe per app kind, each a plain image of what the app already produces:

| App | Build context | Image |
|---|---|---|
| `node-app` | the app's pruned output (`prune` target) | `node:24-alpine`, production dependencies installed, runs as `node`, `HOST=0.0.0.0` so a published port is reachable |
| `react-app` | its production `dist` | `nginx` with a server block that falls back to `index.html` for client-side routes |
| `go-app` | the static `linux-amd64` binary from `build-all` | `distroless/static`, non-root |

An Azure Functions app is refused, because its image is the Functions host's own and needs its own entry point.

The target is called `image`, not `build`, **on purpose**: CI runs every project's `build`, and building an image needs a
Docker engine that an agent may not have (a Windows agent cannot run Linux images at all). Adding a container project
therefore does not change what CI verifies; building and publishing images is a step you add in a pipeline slot where
the agent has Docker. `mnci upgrade` rewrites `tools/container-image.cjs`, the small helper both targets run.

The `container images` e2e section builds a Node, a React and a Go image and talks to the running containers. It needs
a Docker engine, so it skips where there is none and runs in CI's Linux `e2e-containers` job (nightly and on demand).

## A paired Playwright project (`mnci add react-app web --e2e`)

`--e2e` scaffolds `apps/<name>-e2e` beside a React app with `@nx/react:app --e2eTestRunner=playwright`. It is
opt-in, and for React apps only: it adds Playwright to the workspace, and a Node API has no page to drive.

- **The test.** Nx's sample looks for an `h1` containing "Welcome", which mnci's greeting app does not render, so it
  is replaced by `src/greeting.e2e.spec.ts`: open `/` and expect the app's own greeting.
- **What CI verifies.** The project has `lint` and `typecheck` (both pass, and CI's `lint,typecheck,test,build` run
  picks them up); it has no `test` or `build`. Its `e2e` target is **not** part of CI's verify, because it needs a
  browser, and installing one on every agent would cost every run. Run it where a browser exists:
  `npx playwright install chromium`, then `npx nx run <name>-e2e:e2e -- --project=chromium` (the `--` hands the
  flag to Playwright, not to Nx).
- **Commands.** `npm run <name>-e2e:qa` is lint and typecheck. There is no `:build` or `:start`.
- **No per-project ESLint config.** None is generated (`--linter=none`), and the usual sweep covers the directory.

The `react e2e project` e2e section generates one, checks CI's targets, installs Chromium and runs the test against
the built app.

## ES module Node apps (`mnci add node-app|node-function-app --esm`)

Generated Node apps are CommonJS by default, and `npm-lib` packages are ESM-only. `--esm` makes an app an ES module
too: its `package.json` gets `"type": "module"` and its esbuild target builds `esm`; every relative import in its
sources names its file the way `nodenext` resolution needs (`./hello` becomes `./hello/index.js`, which TypeScript
reports as TS2835 otherwise); and its `jest.config.cts` gets a `moduleNameMapper` that resolves `./x.js` back to the
`./x.ts` Jest transforms. It applies to `node-app` (Express, Koa or no framework) and `node-function-app`; Fastify
and Nest keep the layout their framework mandates (autoloaded routes, decorators), so `--esm` is refused with them,
and on any other kind.

Measured on generated apps rather than assumed (the `node esm apps` e2e section): lint, typecheck, test and build are
green; the built bundle is ES module syntax and runs; `prune` keeps `"type": "module"` in the pruned manifest, so
`dist` still runs afterwards; and a **CommonJS** app that depends on an ESM-only library typechecks, builds and runs,
including from `dist` after `prune` and an install there, because Node loads the ES module through `require`
(unflagged from Node 22.12; the e2e says so and skips on older Node).

## The interactive wizard (`mnci` with no arguments)

Bare `mnci` lists **every command** (inside a workspace the Projects and Dependencies sections come first, outside
one the Workspace section does), asks the command's arguments and then the options that apply, prints the command
line it is about to run, and runs it through the same program the flags go through. It reads the commands from the
program itself, so a command or option added to `main.ts` is offered without a wizard change. Two groupings are
kept by hand and checked by a spec: `add` offers the flags of the kind just chosen, and `adopt` asks which step
first (report, baseline tags, toolchain, project kinds, dependencies, overlay) and offers that step's own flags.
`wizard-coverage.integration.spec.ts` fails when a command is missing from the menu, an `adopt` flag belongs to no
step, an `add` flag is reachable for no kind, or the line the wizard builds for an option is not one the program
accepts.

## `mnci adopt`: reading an existing repository before changing it

`mnci adopt` is the start of bringing a repository that already has history, tooling and published
packages under mnci (the plan is #383). So far it is **report mode only and changes nothing**:

```bash
mnci adopt          # what was found, what blocks, what clears each
mnci adopt --json   # the same, as one document
mnci adopt --tags   # step (#379): create the baseline release tags, locally
mnci adopt --toolchain [--nx <version>]   # step (#380): retire old tooling, align Nx, pass the audit
mnci adopt --overlay --scope @org --registry npm --agent ubuntu-latest   # step (#381): the overlay and pipeline
mnci adopt --kinds [--kind apps/api=node-app]   # step (#378): record each project's kind
mnci adopt --dependencies   # step (#392): root runtime dependencies into the projects that import them
```

It reads git and the filesystem (no Nx, no install, no network) and reports the package manager, the
`nx` version, every project manifest, the tags and any release tags stranded under an old project name,
the CI pipelines and whether they already call `mnci ci`, retired tooling (Prettier, oxfmt, verdaccio)
and the root files that are yours (`CLAUDE.md`, `AGENTS.md`). A **blocker** (not a git repository,
uncommitted changes, a package manager other than npm, no projects) makes it exit non-zero; a **warning**
names the later adoption step that clears it. Each later step is its own issue under #383.

**`--tags`** keeps a release from restarting below what was already published. When a project's name changed
(for example `mysql` became `@auto/mysql`), `nx release` finds no tag under the new name and versions from the
disk version. `mnci adopt --tags` creates, for each such project, a lightweight tag under the new name on the
commit of the old one (`@auto/mysql@1.12.11` on `mysql@1.12.11`). It is local and idempotent, never moves a tag,
and prints the `git push` for you to run: publishing tags changes the remote, so that stays your decision.

**`--toolchain`** brings the root toolchain to what mnci supports, as one diff to review. It refuses a directory
that is not a clean git work tree and leaves its changes uncommitted, as `mnci upgrade` does. It removes the
retired formatter configs and dependencies (Prettier, oxfmt, oxlint), the root scripts that call them (a
`format:check` running `oxfmt` fails once the dependency is gone), and the local-registry scaffolding
(`.verdaccio`, `verdaccio`, the `local-registry` target); pins `nx` and every `@nx/*` to one exact version, by
default the newest published in the major already in use (`--nx <version>` overrides it); installs; and runs
`npm audit fix` (never `--force`) until `mnci ci audit` passes, up to four passes. Run on a copy of a real
hand-built workspace it moved Nx 23.1.1 to 23.3.0 and the audit gate passed after one pass.

When the repository has **no Nx at all** (no `nx.json`), the step sets it up first, through Nx's own commands rather
than a template of mnci's: `nx init --plugins=skip` writes `nx.json` and installs `nx`, then `nx add @nx/js` and one
plugin for each of ESLint, Jest and Vitest the root manifest already uses, so the projects get their targets
inferred. Where a package has its own `lint` or `test` script Nx names the inferred target `eslint:lint` or
`jest:test` instead, so the script keeps working under its own name. A repository that already has an `nx.json` is
not touched by this part. The `adoption without nx` e2e section takes a plain npm workspace through it and then
through `--overlay`.

**`--kinds`** records each project's mnci kind as a `type:<kind>` tag, in its `project.json` or the `nx.tags` of
its `package.json` (`mnci projects` shows it). The kind is read from the project itself: an `index.html` next to
React, an `engines.vscode`, an `OutputType` of `Exe`, a `package main`, `lib/main.dart`. Where two kinds fit (a
library that is internal or published, a script that is an app or a library) the project is listed with the
guess and why, and **not** tagged; name it with `--kind <dir>=<kind>` (repeatable) to accept or change the
guess, and the step exits non-zero until every project has a kind. A project that already has a `type:*` tag
keeps it, even one that is not an mnci kind name. Nothing is regenerated and no target is written: Nx infers an
npm project's targets from its scripts. Needs a clean git tree.

**`--dependencies`** moves the root `package.json`'s runtime `dependencies` into the npm projects that import
them. The root is private and never published, and a bundler externalises only what a project's own manifest
declares, so a runtime dependency kept at the root ships as an inlined private copy (`mnci doctor` reports it).
For each root dependency it reads the projects' source (not `node_modules` or build output), adds the package to
every project that imports it from shipped code at the range the root had, to `devDependencies` where only test
files import it, and removes it from the root; it then reinstalls so the lockfile follows. A project that already
declares the package keeps its own range (a different one is reported), and a package no project imports stays at
the root and is listed, because only you know whether it is root tooling or unused. The root's own
`devDependencies` stay: sharing the toolchain is what the root is for. Needs a clean git tree.

**`--overlay`** applies the mnci overlay (release config, `.npmrc`, commitlint, the curated root scripts and the
CI pipeline) to a repository that has an `nx.json`. It is `mnci upgrade` behind adoption's guard rails: it
refuses an unclean git tree, takes the same flags (`--scope`, `--registry`, `--organization`, `--project`,
`--artifacts-feed`, `--agent`, `--variable-group`, `--npm-auth`, `--ci`, `--test-runner`) and fills `--ci` and
`--test-runner` from what the repository already has (its pipeline files, `jest` or `vitest` in the root
manifest). The existing pipeline goes through the legacy migration: steps mnci does not recognise are kept in
the three `# mnci:slot` blocks, the ones it does are replaced by `mnci ci <phase>`, and what cannot be carried
over is listed. Scope, registry and agent have no safe guess, so they are asked for by flag. A repository with no
`nx.json` is told to run `mnci adopt --toolchain` first, which sets Nx up.

## `mnci upgrade`: re-applying the overlay to an existing workspace

Every fix to `workspace-overlay/overlay.use-case.ts` — a release-config correction, a CI guard rewritten,
a new Windows code path — only ever reached _future_ `mnci new` calls until
this existed; nothing let an already-generated workspace pick one up.
`mnci upgrade`, run from the workspace root, closes that gap: it resolves the
same options `new` would have and calls the exact same `applyOverlay` `new`
itself calls — the one function that does every bit of `mnci`-owned file
writing (`nx.json`'s `release`/`sync`/`generators`/`namedInputs.sharedGlobals`/
`mnci` blocks, `.npmrc`,
`eslint.config.mnci.mjs` (**not** `eslint.config.mjs` — see below),
`commitlint.config.mjs`,
`.husky/commit-msg`, the CI pipeline file(s), `.devcontainer/devcontainer.json`, the
`<workspace-name>.code-workspace` file, and the curated root `package.json`
scripts). Nothing else in the workspace — app/lib source, `project.json` targets
from `mnci add` — is ever touched, and it finishes by running `eslint --fix`
over the result, the same way `new` and every `add` do.

The `.code-workspace` file is the one partial case, and deliberately so: its
folders, settings and extensions are regenerated, but the **`tasks` array is read
back and carried through unchanged**. Those tasks are per-project state written by
`mnci add`, not overlay-owned, so regenerating them wholesale would wipe every
project's build/qa/start entry on upgrade.

The `launch` array is handled differently again — **merged by exact name, not carried through**.
The overlay replaces only the four workspace-level configurations it owns (`mnci: build`, `test`, `lint`,
`typecheck`); `mnci add` replaces only its own project's `mnci: <project> start`. Everything else survives an
upgrade: configurations you wrote, and the entries of every other project. (Matching on the `mnci: ` prefix
instead deleted the per-project entries on every upgrade.) The asymmetry with tasks is that the four
workspace-level entries are entirely overlay-authored and should track an upgrade, whereas per-project state is
written by `mnci add`, which the overlay cannot see.

`upgrade` also **deletes** things, which is stronger than the overwriting it
has always done — one more reason to run `git diff` first, as the command's own
output tells you to:

- `create-nx-workspace`'s `.prettierrc` and `.vscode/`, plus every formatter
  config a past mnci version wrote — `.prettierrc.json`, `.prettierrc.mjs`,
  `.prettierignore`, `.oxfmtrc.json`, `oxlint.config.ts`. None of them runs from
  a command line any more, and that is exactly what makes them dangerous: a
  globally installed `esbenp.prettier-vscode` or `oxc.oxc-vscode` still resolves
  one and still reformats on save, undoing Standard while `lint` stays green
  because the damage lands after the check. `.vscode/` is superseded by the
  `.code-workspace` file.
- **every per-project `eslint.config.*` under `apps/`, `libs/` and
  `packages/`.** This is the migration path for a workspace generated before
  mnci owned linting: without it an upgrade would install the root config while
  each project kept linting against its own stale copy. The root config is never
  touched, and neither is a config anywhere outside those three directories.

```sh
mnci upgrade                          # re-apply from persisted config alone
mnci upgrade --agent windows-latest   # override one field; the override is
                                       # persisted too, so the next upgrade
                                       # remembers it
```

Where the options come from: `mnci new` now persists the full set it resolved
(`scope`, `registry`, `agent`, `variableGroup`, `ci`, the stack) into
`nx.json`'s `mnci` block — previously only the stack was kept. `upgrade`
reads that block back; an explicit flag on the `upgrade` command line always
wins over the persisted value. A workspace generated before this was
persisted (or hand-edited to remove a field) gets a clear, specific error
naming the one flag needed (`No npm scope found in nx.json's persisted
config. Pass --scope explicitly.`) rather than a prompt or a guess.

There is deliberately no diff preview or confirmation prompt built in:
`applyOverlay` is a plain, deterministic file-writer (same content in, same
content out, every time), and virtually every generated workspace is already
a git repo — **review the result with `git diff` before committing**, the
same way you'd review any other regenerated file. This does mean `upgrade`
will overwrite hand customizations to any of the files it owns (e.g. an extra
CI job appended by hand to the pipeline file) — `git diff` is exactly how
you'd notice and re-apply those on top.

## Stack: one choice asked up front

`mnci new` (run bare, or with flags) asks one question — the test runner. It is
stored where every later `mnci add` honours it, so the whole workspace stays one
stack:

| Question        | Options            | Default | Stored as / honoured via                                                                 |
| --------------- | ------------------ | ------- | ---------------------------------------------------------------------------------------- |
| `--test-runner` | `jest` \| `vitest` | `jest`  | `nx.json` generator `unitTestRunner` default; the hand-built function app follows it too |

### Your half of the ESLint config

There are two root ESLint files, and the split exists because the old
single-file layout lost work. `eslint.config.mjs` used to be mnci-owned and
rewritten wholesale on every `mnci upgrade` — so a block appended to it, in the
way a comment mnci itself wrote three lines above described, was deleted
without a word. Worse, `upgrade` then tells you to run `npm run format`, so the
first thing that happens after your overrides vanish is every file in the
repository being rewritten against the rules you thought you had changed.

So:

| File | Owner | On `mnci upgrade` |
| --- | --- | --- |
| `eslint.config.mnci.mjs` | mnci | rewritten every time |
| `eslint.config.mjs` | you | written once, then never touched |

`eslint.config.mjs` is what ESLint loads, because `eslint.config.mjs` is
ESLint's own default filename — the file the tool looks for has to be the one
you own, or the tool's default is the one mnci overwrites.

```js
import mnci from './eslint.config.mnci.mjs'

export default [
  ...mnci(),
  { name: 'local/legacy-app-allows-any', files: ['apps/legacy/**/*.ts'], rules: { … } },
]
```

The owned file exports a **function**, not a resolved array, so options still
reach `@mnci/eslint-config` from the file you own:
`...mnci({ verticalSlices: ['packages/*/src/**/*.ts'] })`. An array would have
had nowhere to receive them — mnci's own repository passes `verticalSlices`,
which is how that was caught.

**Upgrading an existing workspace.** If your `eslint.config.mjs` is still the
old single-file one and you never edited it, `mnci upgrade` moves it onto the
split for you: it replaces the file only when it provably holds nothing but
mnci's own output. If you did edit it, it is left exactly as it is and
`mnci doctor` reports that it no longer imports the rules, with the line to
add. mnci does not rewrite that file any more — which is the point, and also
why it cannot do this part for you.

**Linting and formatting are unified across the workspace, from exactly one
pair of config files.** The rules are three lines importing
[`@mnci/eslint-config`](../eslint-config/README.md); every `@nx/*` generator
drops a config into the project it creates, and `mnci add` deletes it. Projects
still get their `lint` target: `@nx/eslint/plugin` infers it by mapping config
_directories_ onto the project roots beneath them, so the root config covers
them all. (Verified, not assumed — and the e2e enforces both "every project has
a `lint` target" and "the root config genuinely reports violations in a project
with no config of its own", because a future Nx change there would silently
switch linting off workspace-wide.)

`mnci` runs `eslint --fix` itself at the end of `new` and every `add`, so a
generated workspace passes its own `lint` immediately — Nx's generators emit
semicolons and double quotes, and without that pass the first commit buries every
real change under generator noise.

**One linter, which is also the formatter.** There is no `--linter` flag and no
choice to make: `@mnci/eslint-config` carries code quality, type-aware rules and
JavaScript Standard Style formatting in a single ESLint config at the root.
`npm run format` is `eslint . --fix --cache`; there is no `format:check`,
because `lint` already reports formatting as ordinary errors with a rule name,
a line and a column.

That is the point of the arrangement rather than a side effect. A formatter and
a linter that both hold style opinions have to be kept in agreement, and the
older setup dodged that only by having ESLint hold *no* style opinion at all —
which is exactly why a formatting mistake produced no squiggle and no message in
the editor. It also makes `space-before-function-paren` enforceable for the
first time: every Prettier-compatible formatter, oxfmt included, rewrites
`function f (a)` back to `function f(a)`.

**`npm run lint` checks one thing `npm run format` does not.** `lint` is
`nx run-many -t lint`; `format` is a bare `eslint . --fix --cache`. The
`@nx/dependency-checks` rule needs the Nx project graph, and outside a target it
prints `No cached ProjectGraph is available. The rule will be skipped.` So a
dependency problem shows up in `lint` and never in `format`, your editor, or a
pre-commit hook.

That asymmetry is now a safety property rather than a hazard. The rule is
**fixable**, and `format` passes `--fix`; when the graph was warm — which it is
after any `nx` command in the same workspace — a `format` run could and did
rewrite `package.json`. `@mnci/eslint-config` turns off the two checks whose
fixers do that (`checkObsoleteDependencies`, `checkVersionMismatches`), so
neither path is destructive, and the skip means `format` cannot reach a manifest
at all. Warm the graph deliberately (`npx nx show projects`) if you want the
rule evaluated in `format` too; mnci does not, because it would make every
format run pay for a graph computation to enforce what `lint` already gates.

**Upgrading an older workspace.** `mnci upgrade` deletes every config a previous
version could have written for a second tool — `.prettierrc`, `.prettierrc.json`,
`.prettierrc.mjs`, `.prettierignore`, `.oxfmtrc.json`, `oxlint.config.ts` — and
drops `prettier`, `oxlint`, `oxfmt` and `@mnci/oxlint-config` from
`devDependencies`. Both halves matter: the files are inert from the command line,
but an editor extension still resolves them, and the VS Code extension resolves a
formatter from the **project's** dependencies, so a stale declaration is enough
to reformat on save against an opinion nothing checks. `mnci doctor` reports a
workspace that has not been upgraded yet.

## `--into`: bootstrapping into a repository that already exists

`create-nx-workspace <name>` creates the directory itself and exits with
`DIRECTORY_EXISTS` when one is already there. That rules out the most common
way a repository actually starts: the host creates it, you clone it, and the
clone holds a `.git` directory, a README and a licence. Doing it by hand means
generating into a temp parent, copying everything except `.git` and
`node_modules` across, and reinstalling — four steps, each of which can quietly
lose a file.

`mnci new --into <dir>` is that, done once and tested:

```sh
git clone git@github.com:me/my-repo.git
cd my-repo
mnci new --into .
```

The workspace name defaults to the directory's name, because the directory is
already named and retyping it is a way to get the two out of step; pass a name
argument to override it.

What it does with the files that are already there is the whole of the risk, so
every case is decided in advance:

| Already in the directory | What happens |
| --- | --- |
| `.git` | Never touched. Keeping it is the point. |
| `README.md`, `LICENSE*` | **Kept.** The generator's README is boilerplate; yours is usually the only hand-written file in the repository. |
| `.gitignore` | **Merged.** Your lines stay, and the generated ones (`.nx/cache`, `dist`, `out-tsc`, …) are appended under a labelled heading. Lines already present are not repeated, so it is idempotent. |
| Anything else the new workspace also writes | **Refused**, naming every collision, before a single file is written. |
| Anything the new workspace does not write | Left alone. |

Two checks, not one. A directory holding `package.json`, `nx.json`,
`tsconfig.base.json`, `node_modules`, `apps/`, `libs/` or `packages/` is
rejected **before** anything is generated — it is a project already, and the
answer there is `mnci upgrade`, not `mnci new`. The full collision check needs
the generated tree, so it runs afterwards, but still before the first write:
a refusal leaves the target byte-identical to how it was found, and the staging
copy is discarded.

### Adopting a flat Go module

A repository with its own `go.mod`, a root `main.go` and `internal/` packages is the
other common starting point, and `--into` takes it as it is. Measured on a clone of a
real one (twelve `internal/` packages, its own `release.yml`):

- **`go.mod` and `go.sum` are never touched.** `add go-*` skips the module bootstrap
  when a `go.mod` exists, so the module path, the `require` lines and the Go version
  survive byte for byte, and no `go.work` is created.
- **The Go plugin is registered anyway.** The bootstrap that registers it in `nx.json`
  is the one that is skipped, which used to leave the plugin installed and unlisted:
  every target worked, and Nx had **no Go project graph**, so `nx affected` skipped an
  app that imports a changed library, silently. `add go-*` now registers it, `mnci
  upgrade` repairs a workspace that adopted before, and `mnci doctor` fails while Go
  projects exist and it is missing.
- **Your own workflow coexists.** A release workflow that fires on `v*` tags and the
  generated `ci.yml`, which fires on pushes and pull requests to `main`, do not overlap.
  mnci tags a released app `<name>@<version>`, so once `--release` and its GitHub
  Release assets do what yours did, delete the old workflow.
- **The format step can fail on a file you already had**, and says so without failing
  the run: a UTF-16 `.json` at the root made `eslint .` report a parse error. The root
  lint covers root-level files, so a repository's existing JSON, Markdown and YAML are
  now inside it; fix or delete what it names.

Landing the code is mechanical, so it is a recipe, not a command (`git mv` and one
import rewrite are the whole job, and a command would have to guess your layout). With
`youtube-downloader` as the module path, `mvd-cli` as the app and `mvd-core` as the
library:

```sh
mnci add go-app mvd-cli
mnci add go-internal-lib mvd-core

# The generated starters are placeholders: drop them.
rm apps/mvd-cli/main.go apps/mvd-cli/main_test.go
rm -r libs/mvd-core/mvdcore

# git mv, not mv, so `git log --follow` reaches the history before the move.
git mv main.go apps/mvd-cli/main.go
for slice in internal/*/; do git mv "$slice" "libs/mvd-core/$(basename "$slice")"; done

# Rewrite the import paths (macOS: sed -i '').
grep -rl 'youtube-downloader/internal/' --include=*.go apps libs \
  | xargs sed -i 's#youtube-downloader/internal/#youtube-downloader/libs/mvd-core/#g'

npx nx run-many -t test,build --projects=mvd-cli,mvd-core
```

Use `nx` and not a bare `go test ./...` from the root: `./...` also walks
`node_modules`, where npm packages that contain Go code sit (one did here). On the
repository measured, this left `go build` clean, every test passing, 62 renames
detected by git, and the app depending on the library in the project graph. The e2e
(`go adoption`) runs this recipe on a fixture and asserts each of those.

Not measured here: whether `golangci-lint`, which is what each Go project's `lint`
runs, passes on a codebase that has never been linted. Run `nx run <lib>:lint` before
relying on it, and expect to fix or silence what it reports.

## Layout convention = release scoping

| Directory          | Contents                                                       | Released?                              |
| ------------------ | -------------------------------------------------------------- | -------------------------------------- |
| `apps/`            | React / Node / Python / Go / Flutter apps (plain or Functions) | Never (packed into the drop)           |
| `apps/` (tagged)   | VS Code extensions (`type:vscode-extension`)                   | Yes — `nx release`, `vsce publish`     |
| `apps/` (tagged)   | Go apps added with `--release` (`release:go`)                  | Yes — `nx release` tag, zips on the GitHub Release |
| `packages/`        | Publishable npm libraries, plus Go and Dart packages           | Yes — `nx release`, per-package tags   |
| `python-packages/` | Publishable Python packages (hatchling wheels)                 | Yes — `twine upload` (Azure Artifacts) |
| `libs/`            | Internal libraries (TS, Python, Go or Dart), never published   | Never                                  |

The directory is very nearly the whole model — one exception, and it is a bug
fix rather than a nicety. `go-lib` also lives in `packages/`, but a Go package
has **no `package.json`**, so Nx's default `versionActions` looks for one that is
not there and aborts _while building the release graph_ — killing `nx release`
for the whole workspace, not just the Go project. It is therefore excluded with
`!tag:type:go-lib` and released **by tag** instead: the `release` phase tags each
`go-lib` `packages/<name>/vX.Y.Z` (the form `go get` resolves for a nested module)
after `nx release`, choosing the version from the conventional commits that touched
its directory since its latest tag (#359). Before 1.0 a `feat` or `fix` is a patch
and a breaking change a minor; from 1.0 they are patch, minor and major; `docs`,
`chore`, `test`, `ci`, `refactor`, `build` and `style` release nothing. The tags
are lightweight, with no GitHub Release or changelog per module, and nothing
propagates between modules. A publishable **Dart**
package in `packages/` needs no such exclusion — `pubspec.yaml` has a real
`version:` field, and `@mnci/nx-flutter` stamps a `versionActions` override that
reads it. Publishable Python packages get their own
`python-packages/` dir so the npm `nx release` (`packages/*`) is never entangled
with Python publishing.

The second exception goes the other way: a **VS Code extension** lives in
`apps/` (it is an application, and the slice lint treats it as one) but is
versioned and published like a package. `release.projects` matches it by its tag,
`tag:type:vscode-extension`, rather than by path: the array is mnci's and is
rewritten by every `mnci upgrade`, so a hand-added `apps/my-extension` would be
lost, while a tag matcher is the same on every upgrade and covers every extension
there will ever be.

The third is an opt-in: a **Go app** added with `mnci add go-app <name> --release`
is tagged `release:go` and joins the release the same way. Without the flag an app
stays unreleased, because most Go apps are internal tools. See _Releasing a Go
app_ in the Go section.

Every kind builds to its own Nx-default output location (`apps/<name>/dist`,
`packages/<name>/dist`, ...) — no post-generation build-output rewiring for
any kind. `mnci add` is pure delegation to the official generators; each
one's own default is left exactly as-is.

## Published packages CAN depend on internal libraries

Import an internal lib from an npm-lib directly — and do **not** add it to the
npm-lib's `dependencies` (npm workspaces links every workspace member into the
root `node_modules` regardless):

```ts
// packages/sdk/src/lib/sdk.ts
import { utils } from '@demo/utils' // libs/utils — private, never published
```

It works because npm-libs are **rollup** bundles: `@nx/rollup`'s `withNx`
externalizes exactly what the manifest declares (`dependencies` +
`peerDependencies`), so real npm deps stay external and declared, while the
undeclared internal lib is compiled from source INTO the bundle — the private
name never reaches the published `package.json`. Trade-off: the published
output is a single bundle (no per-file deep imports).

React apps go the other way (Vite bundles everything by default), and the e2e
proves both directions for real: unlike the published `npm-lib`, which must
keep real npm dependencies **external** (declared, not bundled) for the
published tarball to install correctly downstream, a `react-app` build has no
install step at deploy/runtime, so it inlines **everything** — the private
internal lib AND real npm dependencies alike.

Node apps (`node-app`/`node-function-app`) are a third case: `@nx/node:application`'s
esbuild build is **non-bundled** — it transpiles each file individually and
mirrors the workspace tree into `dist`, so nothing is ever textually inlined.
A private internal lib is compiled by its own `tsc` build and copied into
`dist` at its own path (resolved by a real `require` at run time, the same
way npm workspaces resolve it during development); a real npm dependency
stays a real `require` too, resolved from `node_modules` — present locally,
or installed at deploy time (see "How Node apps work" below).

Cross-project imports (`@scope/lib`) resolve through **TypeScript project
references** under `--preset=ts`, and those references are maintained by
`nx sync`, not by the generators. `mnci add` runs `nx sync` for you right
after generation — but references also go stale **any time you hand-edit a
file to add a new cross-project import** later (nothing about that is an
`mnci add`, so that step can't catch it). For that case every generated
workspace sets `sync.applyChanges: true` in `nx.json`: `--preset=ts` already
registers the `@nx/js:typescript-sync` generator on the `build`/`typecheck`
targets, so instead of just _prompting_ ("Would you like to sync the
identified changes?") on your next `nx build`/`typecheck`/`affected`, Nx fixes
the references **automatically** — no prompt, no manual `npx nx sync`. A
brand-new package may still need one VSCode window reload to be picked up by
the TypeScript server.

`applyChanges` only affects _interactive_ runs, by design: CI always runs sync
generators in dry-run mode and fails instead of silently patching an ephemeral
checkout that never gets committed. That's what the pipeline's `nx sync:check`
step (below) surfaces early — if it fails, run `npx nx sync` locally and
commit the result.

## CI (Azure Pipelines and/or GitHub Actions, any agent OS)

`mnci new` asks which CI provider(s) to write a pipeline file for (`--ci`,
default `azure`): `azure` writes `azure-pipelines.yml`, `github` writes
`.github/workflows/ci.yml`, `both` writes both — pick `github` for a
GitHub-hosted repo, or `both` while migrating between the two. Whichever
provider(s), the pipeline does the **exact same thing**: both files are built
from the same shared guard scripts (`workspace-overlay/overlay.use-case.ts`'s `PYTHON_INSTALL_GUARD`,
`PACK_APPS_GUARD`, `releaseGuard`, `AFFECTED_OR_ALL_GUARD`), so they can never
drift on what CI actually runs — only the provider's own syntax differs. That
matters most for the last of those: the two providers detect a pull request
through different environment variables, so the guard reads both, and a
provider-specific copy would change _what CI verifies_ rather than merely how it
is spelled.

The pipeline contains **no bash and no PowerShell**: every step is a built-in
task/action or a single-line `git`/`npm`/`npx`/`node` command that `cmd.exe`
and `sh` execute identically, so it runs unchanged on Linux, macOS and Windows
agents. The build agent/runner is your choice at `mnci new` (`--agent`,
default `ubuntu-latest`): on Azure a Microsoft-hosted image
(`ubuntu-`/`windows-`/`macos-…`) becomes `pool.vmImage`, anything else a
self-hosted `pool.name`; on GitHub the same value is passed straight through
as `runs-on:` (GitHub's own hosted runner labels already match the common
Azure vmImage names, and a self-hosted label is just as valid there).

Every run (PR and main) installs dependencies, then runs `npm audit`
(non-blocking) and, once the Python toolchain is installed, `pip-audit`
(also non-blocking) — visibility, not enforcement: verified empirically that
a real `npm audit` on this monorepo's own tree flagged nothing but
already-latest upstream packages (`nx`, `verdaccio`) bundling their own not-
yet-patched transitive dependencies, nothing an edit to _this_ workspace's
manifest could fix. A hard-failing audit step would turn CI red for a
problem with no user-actionable fix, for as long as upstream took to patch
it — so both steps always exit 0 regardless of findings, surfacing results
as a clearly labelled section in every CI log instead. The actionable
response to a real finding (a targeted `overrides` entry on just the
vulnerable transitive package) is exactly what this monorepo's own
`fix(deps)` commit did — a manual, reviewed response, not something CI
attempts automatically.

Then `nx sync:check` (fails fast and clearly if the workspace wasn't
synced+committed locally — see above), then **one verify step** running
`lint,typecheck,test,build`. `typecheck` is in that list
because a bundler-built project strips types without reading them, so `build`
passing proves nothing about type correctness.

That step verifies the **affected** projects on a pull request and **every**
project on anything else — including a push to `main`, so a release is always
verified in full. There is deliberately no separate `npm run lint` step: that is
`nx run-many -t lint`, a strict subset of the list above, and on an
affected-scoped PR it would re-lint every project and throw the benefit away.

There is no `format:check` step either, and its removal is not a saving but a
consequence: `lint` reports formatting itself now, so a second step would run
the same binary twice over the same tree.

Every fallback in that step verifies **everything**: no PR target branch, an
unresolvable merge-base (shallow clone, absent remote branch), any non-PR run.
That direction is deliberate — resolving the base too wide costs a few minutes,
while resolving it too narrow means CI runs almost nothing, reports green and has
verified nothing. The base is a `git merge-base`, not either provider's "base SHA"
field and not the GitHub-only `nrwl/nx-set-shas`, so one mechanism serves both
providers and is correct in each by construction.

Pushes to `main` then:

- **Pack all apps** — each app's `package` target zips its build output into
  `dist/drop/<type>-<name>.zip` (e.g. `node-function-app-api.zip`,
  `react-app-web.zip`); the whole `dist/drop` is published as the **`drop`**
  artifact.
- **Tag the run per app** _(Azure only)_ — one build tag per zip, **exactly**
  `<type>-<name>` (derived from the zip filenames, so the tag can never drift
  from the artifact). A classic Azure release/CD pipeline keys its trigger off
  these; GitHub Actions has no equivalent mechanism, so the `drop` artifact
  (one zip per app inside it) is the portable substitute there.
- **Release — version, tag and publish** — one `npx nx release --yes` covering
  npm (`packages/*`), Python (`python-packages/*`) and C# (a `csharp-lib`'s
  NuGet publish): version bump from conventional commits →
  `{projectName}@{version}` git tag pushed to `main` (tag-only, never a
  commit) → publish to the feed (npm via `.npmrc`, Python via `twine` when an
  Azure feed is configured — installed from the generated
  `requirements-dev.txt`, no uv, no Poetry — and a `csharp-lib`'s own
  `nx-release-publish` target running `dotnet pack`/`dotnet nuget push` when
  `NUGET_PAT` is set, self-gating to a no-op otherwise). Reuses the base64
  `PAT`, decoded to the raw token twine needs for the Python publish and to
  the raw token NuGet's `%NUGET_PAT%` substitution needs. Skipped cleanly
  when there is nothing to release. A guarded step installs the fixed Python
  toolchain (`ruff`/`pytest`/`build`/`twine`/`pip-audit`) before any Python
  target runs, skipped cleanly on a workspace with no Python projects. Go and
  Flutter libraries publish by git tag only — see their own sections below —
  so neither needs a step here. On a `--ci=github`
  workspace this same step also creates a **GitHub Release per project**, with
  a changelog Nx generates from conventional commits — `nx release` pushes the
  tag itself here (needs `GITHUB_TOKEN`, which GitHub Actions provides for
  free under the workflow's own `contents: write` permission), so there's no
  separate explicit `git push origin --tags` step on this provider. `--ci=azure`
  and `--ci=both` keep today's behaviour (no GitHub Release, explicit tag
  push) — GitHub Release creation only turns on when GitHub Actions is the
  _only_ configured provider, since that's the one case a `GITHUB_TOKEN` is
  guaranteed to exist.

### Publish auth

The generated `.npmrc` differs by registry kind, because the honest answer does.

**`--registry azure-artifacts`** routes the workspace's own scope to the feed and
supplies the feed's credentials:

```ini
@my:registry=https://pkgs.dev.azure.com/<org>/<proj>/_packaging/<feed>/npm/registry/
//pkgs.dev.azure.com/.../npm/registry/:username=AzureArtifacts
//pkgs.dev.azure.com/.../npm/registry/:_password=${PAT}
```

Scope routing is **real protection** here, not decoration: npm prefers a scope's
registry over the global one when publishing a scoped package, so `@my/*` cannot
reach npmjs.org by accident. Verified against a real registry — with only the
scope line set, npm reports `Publishing to <feed>` — and again from a generated
workspace, whose `npm publish --dry-run` targets the feed.

Only the scope is routed, deliberately. A global `registry=` would push every
install through the feed as well, so `npm ci` would need feed auth just to fetch
public packages; as generated, public dependencies still come from npmjs.org and
a developer with no `PAT` set can install normally.

**`--registry npm`** gets the auth line and nothing else:

```ini
//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}
```

There is no `@scope:registry` line, and the generated file explains why: npmjs.org
is already the default, so routing the scope there changes nothing — and calling
it protection against an accidental public publish would be false, because the
public registry is the intended target. Worth stating plainly because this file
previously claimed exactly that protection while emitting no routing line at all.

**npm auth** is the base64 `PAT`, read the same way on both providers but from
a different place: on Azure Pipelines, a **variable group**
(`--variable-group`, default `Build`) exposes it as `$(PAT)`; on GitHub
Actions it's a plain repository (or environment) **secret** named `PAT`, read
as `${{ secrets.PAT }}` — GitHub has no "variable group" concept, so unlike
Azure this needs no CLI-collected name, just a secret you create once in the
repo settings. Either way it's mapped as `env` on the npm steps and read by
the root `.npmrc`'s `_password` block — the PAT value never lands in a file.
No `npmAuthenticate@0` task in this mode (it would overwrite the hand-set password).
For an Azure feed there is a second mode that needs no PAT at all — see
[the alternative on Azure](#the-alternative-on-azure-build-identity-auth-no-pat-at-all).

#### Why `_password` and never `_authToken` — read this before "fixing" it

Basic auth here is not a legacy choice. Azure Artifacts answers an unauthenticated
`PUT` to its npm publish endpoint with:

```
www-authenticate: Bearer authorization_uri=https://login.windows.net/<tenant>,
                  Basic realm="...", TFS-Federated
```

`authorization_uri` pointing at `login.windows.net` means its **Bearer scheme expects
an Entra ID access token**. A PAT is not one. npm sends `_authToken` *verbatim* as a
Bearer header (it base64-decodes only `_password`), so a PAT placed there is rejected
with:

```
npm publish error:
Unable to authenticate, your authentication token seems to be invalid.
```

**A PAT can only authenticate through the Basic scheme**, which is
`username` + base64 `_password`. That is what this file emits.

The trap worth knowing: a PAT *is* accepted as a Bearer token by the Packaging REST
API (`https://feeds.dev.azure.com/<org>/<proj>/_apis/packaging/feeds` returns 200),
so testing there looks like proof and is not. **Measure the endpoint the code
actually calls.** An `_authToken` change was shipped and reverted on exactly this.

Both feed path forms are keyed (`…/npm/registry/` and `…/npm/`) because npm matches
credentials by URL prefix and walks only *up* a path, so an entry on
`/npm/registry/` is never found for a request to `/npm/`.

#### The alternative on Azure: build-identity auth, no PAT at all

`--npm-auth build-identity` (on `mnci new` and `mnci upgrade`) is the better setup for
an Azure Artifacts feed in the **same organisation** as the pipeline.
`npmAuthenticate@0` injects the build service identity's token — which *is*
Entra-issued, so it satisfies the Bearer scheme the feed advertises — and there is no
secret to store, encode, rotate or let expire.

```bash
mnci upgrade --npm-auth build-identity   # switch an existing workspace
mnci upgrade --npm-auth pat              # and back
```

It changes two files together, which is the point of doing it through mnci rather than
by hand:

1. `.npmrc` keeps only the `@scope:registry=` routing line. No credentials.
2. `azure-pipelines.yml` runs this step **before** `npm ci`, and `npm ci` no longer
   gets a `PAT` mapping it would never read:

```yaml
- task: npmAuthenticate@0
  displayName: Authenticate npm against the feed (build identity, no PAT)
  inputs:
    workingFile: .npmrc
```

The choice is persisted in `nx.json`'s `mnci` block, so a plain `mnci upgrade` keeps it.
A workspace that added the task by hand before this option existed needs no flag either:
`mnci upgrade` sees `npmAuthenticate@0` in its pipeline and keeps that mode, rather than
regenerating the pipeline without it and writing a PAT block the feed rejects. An explicit
`--npm-auth pat` always wins over that detection. `mnci doctor` fails a workspace whose
two halves disagree — a credential-free `.npmrc` with no task publishes nothing (installs
still pass, so CI stays green until the release step's 401), and a PAT block *plus* the
task appends a second credential to a file that already has one.

The remaining manual step is the grant:

3. Grant the build identity **Feed Publisher (Contributor)** on the feed (Artifacts →
   Feed Settings → Permissions). Which identity depends on the job authorization
   scope: `<Project> Build Service (<org>)` when scoped to the project (the default),
   or `Project Collection Build Service (<org>)` when not. A **403** rather than a
   401 is the tell that the wrong identity is in play.

Caveats, stated rather than glossed. This is **Azure-only** — GitHub Actions has no
equivalent task, so `--ci github` and `--ci both` are **refused** with `build-identity`
(the credential-free `.npmrc` would authenticate nowhere on the GitHub side), and so is
public npm, which has no identity to borrow. Those workspaces keep the PAT.
Local development then needs `npx vsts-npm-auth -config .npmrc` (Windows) or a
hand-added credential, since developers no longer inherit one from the file — the
generated `.npmrc` says so in its own comments. Python and NuGet publishing are
unchanged: they read the raw PAT from the variable group, so that group is still needed
for a workspace that publishes either.

#### Diagnosing an auth failure

The error text distinguishes the two schemes, and that is the fastest signal:

| message | meaning |
| --- | --- |
| `E401 Incorrect or missing password` | Basic auth was used and rejected — check the base64 `_password` value |
| `Unable to authenticate, your authentication token seems to be invalid` | a token went out as Bearer and was rejected — a PAT cannot go here |
| `E403` | the credential is valid but lacks publish rights on the feed |

Two things are easy to get wrong when chasing this:

- **`nx release` publishes from the workspace root, not from each project.**
  `@nx/js`'s `runPublish` uses `cwd: context.root` and passes `packageRoot` only as
  the directory argument, so a missing per-package `.npmrc` is never the cause.
- **npm resolves `_authToken` before `username`/`_password` for a given registry
  key** (`hasAuth` in `npm-registry-fetch/lib/auth.js`), and *key* precedence is
  decided before *file* precedence. So a stale `_authToken` in a persistent build
  agent's user-level `.npmrc` outranks the project-level `_password` and the
  workspace's own credential never reaches the wire. Check
  `npm config get userconfig` on the agent before blaming the secret.

On Azure, two one-time grants are required (project admin): **Contribute** on
the repo for the _Project Collection Build Service_ account (tag push), and
**publish** rights on the feed for the PAT's owner. On GitHub, the workflow's
`permissions: contents: write` is what lets its own checkout token push the
release tag — no separate grant, but the job still needs that permission
line (already generated) and, for a fork-based PR, GitHub disables
write permissions by default (not a concern for pushes to `main` from the
repo itself, which is the only case this pipeline ever releases from).

**The one PAT, two different encodings — read this before wiring a third
protocol.** The same `PAT` value (`$(PAT)` on Azure, `secrets.PAT` on GitHub)
is base64-encoded throughout — that's the raw value Azure Artifacts' "Connect
to feed" instructions give you. npm's `.npmrc` `_password` field expects
exactly that pre-encoded form, so it's used as-is. `twine`/pypi basic auth, by
contrast, wants the **raw** token — so the shared `releaseGuard` fragment
(`workspace-overlay/overlay.use-case.ts`, used by both `azurePipelinesYaml` and `githubActionsYaml`)
explicitly _decodes_ the same `PAT`
(`Buffer.from(process.env.PAT, 'base64').toString()`) before handing it to
`TWINE_PASSWORD`. Both are correct for their protocol today, but it's an easy
trap to get backwards: if you ever wire a third registry protocol, check
whether it wants the pre-encoded or the raw form before assuming either
convention.

### Dependency updates (`.github/dependabot.yml`, `github`/`both` only)

A `github`/`both` workspace also gets `.github/dependabot.yml`: weekly update
PRs for `npm` (the root lockfile — covers every `packages/*` project),
`github-actions` (the generated workflow's own actions), and `pip` via
**glob** `directories` (`/apps/*`, `/python-packages/*`, `/libs/*`) rather
than one entry per project — Python projects don't exist yet at `mnci new`
time (`add python-*` writes them later), and a glob matching nothing yet is
not an error, so it starts covering Python dependencies automatically the
moment the first one is added, no `mnci upgrade` needed. Dependabot is
GitHub-native (no app/extension install, unlike Renovate), so it's written
only for `github`/`both` — an `azure`-only workspace gets no
`.github/dependabot.yml`, matching every other GitHub-only file this CLI
writes.

### Nx Cloud (`--nx-cloud`, opt-in)

`mnci new` never connects to Nx Cloud unless asked — `--nx-cloud` (or
answering "yes" to the interactive prompt) opts in; the flagless/`--yes`
default stays fully disconnected, exactly as before this existed. When
opted in, `mnci` passes `create-nx-workspace` a **named** `--nxCloud`
provider value derived from the chosen `--ci` (`azure`→`azure`,
`github`/`both`→`github`) — never the bare `--nxCloud=yes`. Verified
empirically: bare `yes` prompts "Will you be using GitHub as your git
hosting provider?" even with `--no-interactive` set, and exits without
creating the workspace at all when stdin isn't a TTY — a real
`create-nx-workspace` inconsistency, not something `mnci` can configure
around. The named-provider value sidesteps it and completes non-interactively
every time. The only visible effect of _which_ named value is chosen is a
throwaway CI workflow file `create-nx-workspace` writes as a side effect of
Cloud setup — this CLI's own overlay unconditionally overwrites whatever
lands at that path immediately after, so the pipeline you actually get is
always the same one described above, Nx Cloud or not.

Connecting still requires finishing setup in a browser: `create-nx-workspace`
prints a `https://cloud.nx.app/connect/…` URL to complete linking the
workspace to an Nx Cloud account (remote caching, CI insights, `nx
fix-ci`) — `mnci` does not automate that step.

## Dependency & risk notes

Being upfront about what mnci leans on, so it's a conscious trade-off rather
than a surprise:

- **Two Nx plugins this project builds and maintains** carry the most weight,
  both for the same reason — the ecosystem has no maintained, Nx-23-compatible
  option:
  - **`@mnci/nx-python-pip`** (`packages/nx-python-pip`): no maintained plugin
    supports pip. The obvious candidate, `@nxlv/python`, requires `uv`, which
    the company standardizing on this tool does not use.
  - **`@mnci/nx-flutter`** (`packages/nx-flutter`): `@nxrocks/nx-flutter`
    cannot even load on Nx 23 — it imports
    `@nx/workspace/src/utilities/fileutils`, removed in 23 — and there is no
    alternative. Its exposure is smaller than the Python plugin's, because
    scaffolding is delegated to the official `flutter create` rather than
    hand-maintained templates; what this project owns is the pub-workspace
    wiring, the targets and the release integration.

  Both trade third-party risk for a different, real one: **this project owns
  two extra packages' maintenance surface** (generators, executors, their own
  release cycles). Unlike official `@nx/*` plugins, if either needs fixes, this
  project owns them directly. That is the cost of the gaps in the ecosystem.

- **`@nx-go/nx-go` is a third-party plugin on a declared-incompatible range.**
  It declares `@nx/devkit ">= 20 < 23"` while this workspace runs Nx 23. That
  range is a plain dependency rather than a peer, so npm nests its own devkit
  copy and everything works — validated empirically against a real Nx 23.1.0
  workspace (generators, build, test, lint). It is still a version trap worth
  re-checking on Nx upgrades.
- **The TS7 dual-compiler aliases pin a very new, fast-moving dependency.**
  TypeScript 7's native compiler is recent; `TS_COMPILER_DEPENDENCIES` pins
  `npm:typescript@^7.0.2` / `npm:@typescript/typescript6@^6.0.2` specifically
  because the alias trick is what makes it work at all today (see "Stack"
  above). A semver-compatible upstream release could still change behavior or
  break the alias before the rest of the ecosystem (Nx, typescript-eslint)
  catches up — worth a periodic re-check, not a "set and forget."

## Known gaps (accepted for the experiment)

- **A scoped package on public npm has no accidental-publish protection**, and
  cannot: npmjs.org is the intended target there, so no `.npmrc` line could
  prevent it. Generate with `--registry azure-artifacts` if you need a scope kept
  off the public registry — that variant routes it (see **Publish auth** above).
- No `doctor`/`resurrect`/`spell` — out of scope until the model is proven.
- **Flutter apps build for web only.** Android would require the Android SDK and
  NDK on every build agent; iOS is impossible on a Linux agent regardless. Add
  other platforms per-app with `flutter create --platforms=...` — the generated
  `build` target only knows about web.
- Azure Functions Core Tools is only needed for **local** `func start` — never
  for `mnci add node-function-app`/`python-function-app` generation, since
  neither shells out to the `func` CLI.
- Function-app _deployment_ (e.g. `AzureFunctionApp@2`) is not wired into the
  pipeline; the `node-function-app-<name>.zip`/`python-function-app-<name>.zip`
  inside the published `drop` artifact is the deploy input. Deploying it means
  Azure's Oryx build installing real dependencies (`npm install`/`pip install`)
  from the zipped manifest — no `node_modules`/venv is bundled.
- Changelog **files** are off everywhere (unpushable under the tag-only
  model — `git.commit` stays `false`, so a written `CHANGELOG.md` would just
  be discarded at the end of every CI run). On a `--ci=github` workspace (and
  only that one — see below) each release still gets a real changelog: Nx
  generates it from conventional commits and posts it straight to a GitHub
  Release, with no file ever touched. `--ci=azure` and `--ci=both` fall back
  to the git tag history as the changelog, same as before.
- **No lock file for Python** — plain pip has none, matching the company
  standard this migration was for. A published wheel's `Requires-Dist` mirrors
  whatever specifier the `pyproject.toml` declares (e.g. `tomli>=2.0.0`)
  verbatim, not a resolved/pinned version the way `uv.lock` would have
  produced. `requirements-dev.txt` (the fixed `ruff`/`pytest`/`build`/`twine`/
  `pip-audit` toolchain) is unpinned for the same reason — pin it by hand if
  the workspace needs reproducible CI tool versions.
- venv management is left to the user (same spirit as never managing
  `node_modules` beyond `npm install`): `mnci` neither creates nor activates
  one. CI installs `requirements-dev.txt`, then editable-installs every
  Python project workspace-wide (see "Workspace-wide install" above),
  straight into whatever `<python>` resolves to on the agent (`python3` on
  POSIX, `python` on Windows — see above); locally, create your own venv
  (`python3 -m venv` / `python -m venv` on Windows) and run
  `npm run python:install` to reproduce the same two installs — the root
  script chains the identical two guards CI runs (see the scripts table
  above).

## How Node apps work (plain `@nx/node:application`, no Azure Functions plugin)

`node-app` and `node-function-app` are both the **official**
`@nx/node:application` generator (`--bundler=esbuild`) — no third-party Azure
Functions plugin, and no post-generation build-output rewiring.
`node-function-app` is exactly that generator plus a hand-written Azure
Functions v4 file overlay, the same split `python-app`/`python-function-app`
already use:

- **`node-app` framework choice** (`--framework`, default `none`): plain flag
  plumbing to the generator's own `express`/`fastify`/`koa`/`nest`/`none`
  choices — `mnci` adds no framework-specific logic of its own. Verified
  empirically that all four scaffold, build and test cleanly on Nx 23.1.0.
  One quirk worth knowing: `--framework=nest` silently overrides
  `--bundler=esbuild` — NestJS needs its own webpack build (decorator/DI
  metadata emission esbuild's transform-only approach can't produce), so a
  `nest` app's `dist/main.js` is a single webpack bundle instead of the
  esbuild non-bundled mirrored-tree + shim the other frameworks (and `none`)
  produce. The `package` target needs no framework branch either way — both
  shapes' runnable entry is `dist/main.js`, so zipping the whole `dist` folder
  works unchanged. `node-function-app` never accepts `--framework`: the Azure
  Functions v4 programming model (`app.http(...)` registration) runs its own
  request lifecycle, so a full HTTP server framework doesn't apply there.

- `build` = the generator's own `@nx/esbuild:esbuild` target, **non-bundled**
  (`bundle: false`): it transpiles each file individually and mirrors the
  workspace tree into `apps/<name>/dist` (e.g.
  `apps/<name>/dist/apps/<name>/src/main.js`), plus a `dist/main.js` shim that
  `require`s the compiled entry — verified empirically, and the one thing that
  makes `main.js` a stable, generator-provided deploy entry point regardless
  of the nested path. A private internal lib is compiled by its own `tsc`
  build and copied into `dist` at its own path; a real npm dependency stays a
  real `require`, resolved from `node_modules`.
- `test`/`lint` = the generator's own targets (`--unitTestRunner`/`--linter`
  passed straight through, same as every other kind) — nothing needs
  hand-wiring here.
- `package` (added by `mnci add`, not the generator) zips `apps/<name>/dist`
  into `dist/drop/node-app-<name>.zip` (`node-app`) — for `node-function-app`
  it additionally zips in `host.json` and the repaired `package.json` into
  `dist/drop/node-function-app-<name>.zip`. No `node_modules` is bundled
  either way: for the function app, Azure's Oryx build installs real
  dependencies from the zipped `package.json` at deploy time — the exact same
  model `python-function-app` already relies on for `requirements.txt`
  (verified empirically: a plain `npm install` in a simulated deploy folder,
  with no bundled `node_modules`, resolves and runs correctly once the
  dependency is declared).
- **`node-function-app` overlay**: `@azure/functions` is installed for real
  (a plain `@nx/node:application` app has no Azure dependency by default,
  unlike a plugin-generated one), an HTTP-triggered `app.http(...)` sample
  (v4 programming model) is written as a `src/hello/` slice (`hello.handler.ts` adapting the transport, `greet.use-case.ts` and its spec, `greeting.contract.ts`, behind an `index.ts`; `--empty` skips the slice), `host.json` is
  added, and the manifest is repaired — `main: 'main.js'` (the dist shim) and
  `@azure/functions` added to `dependencies` for Azure's deploy-time install
  to find.
- **Convention** (both kinds): `src/main.ts` is the esbuild entry — add one
  import per function slice you create under `src/` (through its `index.ts`), or it won't be
  reachable (and thus won't be transpiled into `dist`).

## How React apps work (one build per environment)

A React SPA bakes its config in at **build time** (`import.meta.env.VITE_*`),
so it needs a separate build per environment. `add react-app` wires that up
with Vite's own **modes**:

- Scaffolds `.env.dev`, `.env.uat`, `.env.prod` — put each environment's public
  `VITE_*` config there (these values ship in the browser bundle, so they are
  public by definition; real secrets never belong here). The files are
  committed (an allow-rule keeps them out of `.gitignore`).
- Adds `build-dev` / `build-uat` / `build-prod` targets, each
  `vite build --mode <env> --outDir dist-<env>`, so every environment gets its
  own compiled-in config. The default inferred `build` (single build) stays
  for local dev and the CI verify step.
- `package` builds all three and zips each into
  `dist/drop/react-app-<name>-<env>.zip` — **one artifact per environment**.

CI needs no change: the per-app tag step derives one build tag per zip, so you
get `react-app-<name>-dev` / `-uat` / `-prod`, and the classic release pipeline
deploys each environment from its own artifact + tag. Need different
environments? Edit `REACT_ENVIRONMENTS` in the generator.

**A React app can also ship inside a Go binary**, for an app that serves its own UI
(`mnci add go-app <name> --web <react-app>`): the default `build` is what gets
embedded, not the per-environment ones, so the app should call its API on the same
origin (`/api/...`). See _Serving a React app from a Go app_ in the Go section.

## Python (`@mnci/nx-python-pip` — pip + Ruff + pytest + PyPA `build`/`twine`, no uv)

Python is the first non-JS language, and follows the same philosophy as every
other kind — pure delegation to a real Nx plugin generator — except the
plugin is one this project built and maintains itself:
[`@mnci/nx-python-pip`](../nx-python-pip) (`libs/nx-python-pip` in this same
monorepo). No maintained, Nx-23-compatible Python plugin supports pip
(verified empirically: the previous plugin, `@nxlv/python`, ships only uv and
Poetry providers; every alternative found on npm is either the same
uv/Poetry architecture or years stale), so rather than keep hand-authoring
Python projects forever inside `add/python.ts` (the position this repo was in
right after dropping `@nxlv/python`), the generation logic was extracted into
a proper, independently testable, independently publishable Nx plugin —
`add/python.ts` now just calls `nx g @mnci/nx-python-pip:<kind>`, the same
shape as `react-app`/`node-app`/`npm-lib`.

`@mnci/nx-python-pip` ships real `@nx/devkit` generators (`application`,
`library`, `internal-library`, `function-application`) and real TypeScript
executors (`build`, `test`, `lint`, `publish`) — not `nx:run-commands`
wrappers — so `nx-release-publish`'s `dryRun` arrives as a genuine typed
executor option (`nx release publish --dry-run` sets it automatically for
every custom executor, no argv-parsing trick needed), and internal-lib
vendoring resolves a dependency's location via the real Nx **project graph**,
not a hard-coded `libs/<name>` path. `mnci add python-*` installs it like any
other npm devDependency (`npm install --save-dev @mnci/nx-python-pip` —
no `nx.json` `plugins` registration needed, since its generators/executors
are explicit, not inference-based) and writes exactly one file itself:
`requirements-dev.txt` at the workspace root (the fixed `ruff`/`pytest`/
`build`/`twine`/`pip-audit` toolchain — install with `<python> -m pip
install -r requirements-dev.txt`), since the plugin is a generic Nx plugin
with no
opinion on how its own runtime dependencies land on a machine. There is **no
stack question** — Ruff (lint + format) and pytest are the standard, so they
are always used, invoked as `<python> -m <tool>` everywhere (not a
hard-coded venv path), so the exact same command works whether or not a venv
is activated. `<python>` resolves to `python3` on POSIX or `python` on
Windows (the standard python.org Windows installer registers no
`python3.exe`) — every guard script in the generated pipeline and every
`@mnci/nx-python-pip` executor makes this same platform check, never a
hard-coded name, so a `windows-latest` (or self-hosted Windows) agent works
identically to a Linux/macOS one.

| Kind                  | Location                 | Build / deploy                                                                                                                                                                                                                 |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `python-app`          | `apps/<name>`            | `python -m build` wheel (the plugin's `build` executor), zipped by mnci into `dist/drop/python-app-<name>.zip`                                                                                                                 |
| `python-function-app` | `apps/<name>`            | Azure Functions **v2** (`function_app.py` + `host.json` + `requirements.txt`); no `pyproject.toml`/wheel — the **source** is zipped by mnci into `dist/drop/python-function-app-<name>.zip` (no `func` CLI needed to generate) |
| `python-lib`          | `python-packages/<name>` | publishable wheel; the plugin's `publish` executor (`twine upload --skip-existing`)                                                                                                                                            |
| `python-internal-lib` | `libs/<name>`            | private shared code, lint + test only — no build/package target of its own                                                                                                                                                     |

- **Apps** get a `package` target — mnci's own CI packaging convention, not
  a generic plugin concern — merged into the plugin-written `project.json`
  after generation, fitting the existing CI unchanged: the pipeline's
  `apps/*` pack step tags them `python-app-<name>` / `python-function-app-
<name>` just like the TS apps.
- **Internal-lib vendoring** replaces `@nxlv/python`'s `bundleLocalDependencies`:
  plain pip has no bundled-local-dependency feature, so a project that imports
  a workspace-internal Python library needs a `vendor` entry (under
  `[tool.mnci-python-pip]`) in its own `pyproject.toml` (the pip-world
  counterpart of a `dependencies = [...]` entry — neither mnci nor the plugin
  wires cross-project Python dependencies automatically). `mnci add
python-vendor <consumer> --lib <name>` automates writing that entry —
  idempotent (safe to run twice), and works on any consumer with a
  `pyproject.toml` (app, publishable lib, or another internal lib), not just
  apps. The plugin's `build` executor reads the entry, resolves the named
  project's root via the **Nx project graph**, copies its module into a
  staged copy of the consuming project, and builds from there — so the
  resulting wheel contains the vendored module as a real top-level package.
  Verified empirically that this does **not** reproduce the old
  `@nxlv/python` bug where combining a vendored internal lib and a real
  external dependency on the same project silently dropped the external one
  from the wheel's metadata — both survive correctly.
- **Workspace-wide install** (mnci's own CI step, not the plugin's) — pip has
  no npm-workspaces-style hoisting, so mnci writes one: a guarded step
  editable-installs every Python project (`apps/*`, `python-packages/*`,
  `libs/*` — any with a `pyproject.toml`) into one shared environment in a
  single `pip install` call, plus `-r`-installs every function app's
  `requirements.txt`. This is the pip-world counterpart of `npm install`
  hoisting every workspace package into one root `node_modules`, and it is
  what lets a project that vendors an internal lib (see above) resolve that
  import at **lint/test/dev time**, not only inside the final wheel — the
  plugin's own `test` executor (`installEditable`) only editable-installs the
  project under test, not what it imports. Skipped cleanly on a workspace
  with no Python projects.
- **Release** is unified with npm: `nx release` scopes both `packages/*` and
  `python-packages/*` in one flat project list (deliberately not two named
  `release.groups` — Nx hard-errors the whole release when an explicit group
  matches zero projects, a real failure mode for a Python-only or npm-only
  workspace, verified empirically), so a Python package is **versioned from
  conventional commits and tagged** `{projectName}@{version}` exactly like an
  npm one — its `pyproject.toml` version bumps, tag-only (never a commit).
  The plugin's `library` generator sets a project-level
  `release.version.versionActions` override pointing at
  `@mnci/nx-python-pip/release/version-actions` (a `VersionActions`
  implementation — six methods, verified empirically against a real `nx
release version --dry-run`), which wins over the workspace's default
  (npm's) `versionActions` for that one project. **Publishing** reuses the
  registry: an Azure Artifacts feed is **multi-protocol**, so the same
  org/project/feed serves Python — the release step exports `TWINE_*` (URL +
  the base64 `PAT` decoded to the raw token twine needs, no second secret) and
  `nx release` publishes the wheels with `twine`. (On a public-npm workspace a
  Python package is still versioned + tagged, but publishing it needs
  user-provided `TWINE_*` — e.g. a PyPI token.)
- **CI** also runs `nx run-many -t lint,test,build`, so Python's ruff `lint`
  target runs alongside the JS ESLint build. One guarded pipeline step installs
  `requirements-dev.txt` first (the fixed toolchain), then a second installs
  every Python project workspace-wide (the workspace-wide install above) —
  both skipped cleanly when the workspace has no Python projects.

## Go (`@nx-go/nx-go` — a `go.mod` per project, a root `go.work`, golangci-lint + `go test`)

Requires **Go 1.21+** on the machine and on the build agent; `mnci add go-*`
fails fast with an install link when `go` is not on the `PATH`. The generated
pipeline installs `golangci-lint` itself (see below).

| Kind              | Location          | Build / deploy                                                                                                                                                                                                |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `go-app`          | `apps/<name>`     | `go build` binary into `dist/apps/<name>/`, zipped by mnci into `dist/drop/go-app-<name>.zip`; `build-all` / `package-all` cross-compile six platforms into `dist/platforms/<name>/<goos>-<goarch>/` and zip each (`VERSION` env stamps `main.version`)                                                                                                                 |
| `go-function-app` | `apps/<name>`     | same build; zipped into `dist/drop/go-function-app-<name>.zip`. The handler body is yours to write — AWS Lambda, Google Cloud Functions and Azure each want a different signature, and mnci does not pick one |
| `go-lib`          | `packages/<name>` | publishable **by git tag** — see below; lint + test targets only                                                                                                                                              |
| `go-internal-lib` | `libs/<name>`     | private shared code, lint + test only — a non-`main` package produces no binary                                                                                                                               |

- **One `go.mod` per project, and a root `go.work` mnci owns** (#289), so a Go
  project's dependencies are declared in that project, like every other
  language's. `project-scaffolding/go.use-case.ts` bootstraps the workspace on
  the first Go `add` with the plugin's `init` (no `convert-to-one-mod`); each
  generator then writes its own `go.mod`, whose module line mnci rewrites to
  `<host>/<org>/<repo>/<dir>` from the git origin. Siblings import each other
  by that path, and `go.work` resolves them locally, with no `replace`
  directives.
- **The `go` directive is held to 1.24 where mnci writes it, and nowhere else** (#348, #425). The plugin copies the
  developer's Go version into `go.mod` and `go.work`, and CI's `golangci-lint` refuses a module newer than the Go it
  was built with, which fails every Go lint target on the first CI run, and only for a developer on the newest Go.
  So a new project's `go.mod`, and the `go.work` mnci creates, are capped at 1.24. A `go.work` the workspace already
  has is never touched: raise it by hand when a module needs a newer Go, and later `mnci add` calls leave it alone.
- **A Go library is a capability of slice packages.** The plugin's library
  generator writes `<name>.go` at the project root, which makes the root
  package the whole library. mnci replaces it with a root `doc.go` and moves
  the sample into one starter slice package (`libs/markdown-workspace/
  markdownworkspace/markdown_workspace_use_case.go`), the Go spelling of the
  `<kebab>.<role>.ts` files the TypeScript scaffolds get. Rename the starter
  after the outcome it delivers and add one package per further outcome.
- **`test` and `lint` reach every slice package.** The plugin's executors run
  `go test ./...` and `golangci-lint run ./...` from the project root
  (measured on `@nx-go/nx-go` 4.1.1), so mnci passes no package list. The e2e
  plants a failing test and a lint finding in a nested package and asserts
  both fail the project target, so a plugin change that stopped recursing
  would surface there rather than as a silently green lib.
- **The `go.work` multi-module layout was first rejected and then adopted**
  (#289), because per-project dependencies are the point. Its one hazard is
  real: a single stale `use` entry — a project directory removed by hand —
  makes `go list -m -json` fail, and that breaks the **entire** Nx project
  graph, not just the Go projects. `mnci doctor` fails on one and names the
  line to remove.
- **Targets are written explicitly** rather than inferred. `@nx-go/nx-go`
  supplies `build`/`test`/`lint` by inference, but mnci writes them into
  `project.json` explicitly so lint is pinned to `golangci-lint` (the plugin's
  default is `go fmt`, which only reformats), as it already does for most
  kinds.
- **The project graph is still inferred, so `affected` is correct.** What the
  plugin does not infer is targets; it still derives the _graph_ from imports.
  An app that imports `libs/<name>/<slice>` depends on that lib, transitively,
  and every app sharing a lib is affected when it changes (measured on
  `@nx-go/nx-go` 4.1.1 with Nx 23.2.0, including a dependency created only by a
  test file's import). That matters because the pipeline verifies only the
  affected projects on a pull request: a missing edge would let a lib change
  pass without testing the apps that use it. The e2e pins the edges and the
  affected sets (MoNecromanCI/MoNecromanCi#260), since they are the plugin's
  behaviour rather than mnci's.
- **Lint is `golangci-lint`, pinned deliberately.** The plugin's `lint`
  executor defaults to `go fmt`, which only reformats — a green lint step
  with that default would mean nothing. The generated target passes
  `linter: golangci-lint`, and `mnci add` warns (without failing) when the
  binary is missing locally, since CI installs its own.
- **Publishing a `go-lib` is a git tag, not a registry upload.** The whole
  repository is one module, so consumers depend on a library by import path
  at a repo-level version tag — `go get <module>/packages/<name>@v1.2.3`.
  That tag is the one `nx release` already creates, so no
  `nx-release-publish` target is written: there is nothing to push. The only
  real difference between `go-lib` and `go-internal-lib` is intent, recorded
  in the `type:go-lib` tag and the `packages/` location.
- **Pure-Go apps are cross-compiled; an app that needs a C toolchain is not
  (`mnci add go-app <name> --cgo`).** `build-all` builds six static binaries from
  one machine with `CGO_ENABLED=0`, which is right until the app needs cgo: a
  system-tray icon (Cocoa on macOS, GTK on Linux), a native GUI toolkit, a cgo
  database driver. Those can only be built where the C toolchain and the target
  OS's libraries are, so a `--cgo` app is tagged `build:cgo` and gets
  `build-native` and `package-native` (this machine only, `CGO_ENABLED=1`, the
  same `VERSION` stamp and `-trimpath`, the zip named as `package-all` names a
  platform's) **instead of** `package`, `build-all` and `package-all`. It keeps
  `build`, `test`, `lint` and `start` for local work.
  - **A `native` job, only when such an app exists.** The generated pipeline
    gains a job with one leg each on `windows-latest`, `macos-latest` and
    `ubuntu-latest` (GitHub Actions: a matrix; Azure Pipelines: a matrix of
    `vmImage`s, with the original job moved under `jobs:`). Each leg lints,
    tests, builds and packages the native apps and publishes its zips as an
    artifact. The single-agent verify excludes them (`--exclude=tag:build:cgo`),
    because it cannot build them. A workspace with no native app keeps a
    pipeline byte-identical to the one it had: the job is decided when the file is
    written, since neither provider can skip a whole job on a file's existence.
  - **Run `mnci upgrade` after adding one.** `add` does not rewrite the
    pipeline files, so until then CI would verify the app on the one agent that
    cannot build it. `mnci add` says so, and `mnci doctor` fails while a
    pipeline lacks the job, and while no C compiler is installed on the machine
    (it reads `CC`, then `gcc`, `clang`, `cc`).
  - **Linux prerequisites are yours to finish.** The leg installs a C compiler
    and `pkg-config`, which is all mnci can know. The `-dev` packages your app
    links (`libgtk-3-dev` and `libayatana-appindicator3-dev` for a tray icon) go
    on that one marked line in the pipeline. The macOS runner ships Xcode's tools,
    and the Windows leg relies on the hosted image's MinGW-w64 `gcc`: the nightly
    e2e builds a cgo app on `windows-latest`, and says so loudly if it finds no
    compiler there rather than passing.
  - **Architectures: one per OS, the runner's own.** `windows-latest` and
    `ubuntu-latest` are amd64 and `macos-latest` is arm64, so a native app ships
    `windows-amd64`, `linux-amd64` and `darwin-arm64`. `darwin-amd64`,
    `linux-arm64` and `windows-arm64` are not built: they need an Intel macOS
    runner, an arm Linux runner or a cross-compiler. The legs are fixed in the
    generated pipeline today, so adding one means editing a file `mnci upgrade`
    rewrites (MoNecromanCI/MoNecromanCi#269 is about giving that a safe place).
  - **Releasing one.** With `--release` as well, each leg, on a push to main and
    after the `ci` job has tagged, runs
    `node tools/go-app-release.cjs assets --native`, which builds
    `package-native` with `VERSION` set to the tag's version and uploads that
    OS's zip to the same GitHub Release, so one release collects a zip from every
    runner. Azure Pipelines has no GitHub Release to attach to and stops at the
    artifact.
- **Serving a React app from a Go app (`mnci add go-app <name> --web <react-app>`).**
  For an app that runs a local server and is used in a browser, shipped as one
  self-contained binary. `//go:embed` cannot reach outside its package directory,
  and a React app builds into its own `apps/<react-app>/dist`, so the Go app needs
  wiring mnci writes for you (the React app has to exist first):
  - **`stage-web`** copies that `dist` into `apps/<name>/web/`, after the React
    app's `build`, and the directory is git-ignored (an `apps/<name>/.gitignore`).
    Its output is declared and its inputs are the React build's outputs, so Nx
    caches it and a change to the React code reaches the binary.
  - **Every target that compiles Go depends on it**: `build`, `test`, `lint`,
    `start`, `build-all` and `build-native` (`package*` reach it through those).
    `//go:embed` fails at compile time without its files, so on a fresh checkout
    `go vet`, `go test` and `golangci-lint` fail as well as `go build`. A committed
    placeholder was rejected: staging replaces the directory, so git would show it
    modified for ever. The cost is that a Go-only change waits for a React build
    on a cold cache, and your editor shows the embed error until the first
    `nx run <name>:stage-web`.
  - **The project graph knows**: `implicitDependencies` makes the React app a
    dependency, so changing it marks the Go app affected, while changing the Go
    app does not rebuild the React app.
  - **The sources**: `main.go` becomes a small server (`ADDR`, default
    `127.0.0.1:8080`) that logs the stamped `version`, `web.go` embeds the staged
    files and serves them (an unknown path falls back to `index.html`, so a
    client-side route survives a reload), and `main_test.go` checks the embed holds
    a page. They replace the generated hello world.
  - **`nx run <name>:dev`** starts the Vite dev server and the Go server together.
    `add` adds `server.proxy: { '/api': 'http://127.0.0.1:8080' }` to the React
    app's Vite config (and tells you what to add if it cannot find a `server`
    block), so the browser talks to Vite and `/api` reaches Go.
  - **Releasing one.** `package-all` stages once and builds six binaries from the
    same copy. A native (`--cgo`) app is built on a runner per OS, and **each leg
    rebuilds the React app**: sharing one frontend build between runners is not
    done yet.
  - Types shared between Go and TypeScript (OpenAPI, generated types) are out of
    scope.
- **A commit can force a project's version (#283).** A commit whose subject is
  `version(<project>)[<version>]: <message>` (aliases `mnci-version`, `mnci-ver`,
  `mnci-force`, `mnci-v`, `ver`, `force`, `v`) makes `mnci ci release` release that
  project at exactly that version, over what the conventional commits would give.
  `<project>` is the name its release tags carry (`@scope/name` for a scoped
  package). The project is released first with an exact specifier, and everything
  else follows in a second `nx release` call, so the other projects keep their
  automatic versions. Only the newest such commit since the project's last tag
  counts, a version at or below the newest tag is ignored, and a name Nx does not
  know is reported and skipped. `RELEASE_SPECIFIER` wins over all of them. The
  generated `commitlint.config.mjs` accepts the aliases and the `[<version>]`
  part (`mnci upgrade` rewrites it).
- **Releasing a Go app is an opt-in: `mnci add go-app <name> --release`.** The
  app is tagged `release:go`, which `release.projects` selects by tag (as it
  does for a VS Code extension, so `mnci upgrade` keeps it). Without the flag
  an app is never released.
  - **Versioned from its git tag, with no manifest.** Nx's default
    `versionActions` reads a `package.json`, and a project without one aborts
    the release for the whole workspace, so the app carries a project-level
    `release.version` pointing at `tools/go-app-release.cjs` and resolving its
    current version from the tag (`<name>@<version>`). The same file is the
    `versionActions`: it declares no manifest and writes nothing, which fits
    because mnci releases never commit. `mnci upgrade` rewrites it, so local
    edits do not survive.
  - **The first release is `0.0.1`.** With no tag yet, the base is `0.0.0` and
    Nx bumps it by its own rule for a `0.x` version. To start somewhere else,
    push a `<name>@<version>` tag before the first release (`mvd-cli@0.9.0`),
    or set `RELEASE_SPECIFIER` to an exact version.
  - **It carries a publish target that publishes nothing.** `nx release` tags
    first and publishes last, and a project matched for publishing without an
    `nx-release-publish` target made it exit 1 _after_ the tag existed
    (measured). Publishing a Go app is its tag.
  - **The platform zips are attached to the GitHub Release, GitHub Actions only.**
    After `nx release`, the generated workflow runs
    `node tools/go-app-release.cjs assets`: for each app tagged by this run it
    builds `package-all` with `VERSION` set to the new version, so the binary
    reports it, and uploads `dist/drop/go-app-<name>-<goos>-<goarch>.zip` with
    `gh release upload --clobber`, so a re-run is harmless. A run that released
    nothing uploads nothing. Azure Pipelines (and `--ci both`'s Azure side)
    creates the tag but has no GitHub Release to attach to, so it attaches
    nothing.
  - **A change to a library the app imports releases it too.** Nx counts the
    commits that touch an app's dependencies, not only its own folder (measured:
    a `fix:` touching only an imported `go-internal-lib` produced a patch
    release of the app), which is right for a binary that links the library in.
  - An app that needs a C toolchain is released from several runners instead:
    see _Pure-Go apps are cross-compiled_ above. This step builds all six
    platforms on one runner, which is what `CGO_ENABLED=0` allows.
- **No publish-time dependency injection**, unlike Python's vendoring: `go
build` links statically, so the binary in the drop already contains
  everything it needs.
- **Build output is a directory**, `dist/apps/<name>/`, with the binary
  inside it. The executor's own default writes a bare file at
  `dist/apps/<name>`, which cannot be declared as an Nx `outputs` entry —
  Nx scans each declared output to cache it, and scanning a file fails with
  `ENOTDIR`. Building one level deeper keeps the root-`dist` convention and
  makes the target cacheable.
- **CI** runs Go through the same `nx run-many -t lint,test,build` as
  everything else. Two guarded steps precede it: `go mod download` (so a
  network failure reads as a dependency failure rather than a confusing
  build error), and a `golangci-lint` install whose `GOPATH/bin` is then added
  to `PATH` for later steps. The linter is **pinned** (`GOLANGCI_LINT_VERSION`)
  and installed from its prebuilt release, verified against the release's
  SHA-256 checksums, in about a second; compiling it with `go install` took
  over a minute per run. Any download or verification failure falls back to
  `go install` at the same pinned version. All three skip cleanly when the
  workspace has no root `go.mod`, and the linter install also skips when the
  agent already provides it.

## VS Code extensions (`@nx/node:application` + `vsce`)

`mnci add vscode-extension <name>` scaffolds with the plain `@nx/node:application`
generator (your test runner, esbuild) and turns the result into a Marketplace
extension:

- **Bundled.** `bundle: true`, `thirdParty: true`, `external: ['vscode']`. A `.vsix`
  ships no `node_modules`, so the generator's un-bundled mirror of the source tree
  could not run in the extension host; `vscode` is the host's own module.
- **A manifest `vsce` accepts.** Unscoped `name` (`vsce` rejects scopes),
  `publisher` (`--publisher`, default the workspace scope without `@`),
  `engines.vscode` pinned to the installed `@types/vscode` (`vsce` refuses types
  newer than the engine range), `main: ./dist/main.js`, empty `activationEvents`
  (VS Code activates on a contributed command by itself since 1.74) and one sample
  command. Tagged `type:vscode-extension`, and `nx.name` pins the Nx project name
  to the folder, so `name` (the Marketplace id is `<publisher>.<name>`) and
  `displayName` are yours to change: packages stay `<project>[-<target>].vsix`
  and every script, task and launch entry keeps working. Run `npm install` after a
  rename and commit the lock with it: `apps/*` is an npm workspace, the lock records
  the app by `name`, and CI's `npm ci` refuses a lock that names a package no
  manifest does (`mnci add` refreshes it for the name it writes, #251).
- **`src/main.ts`**, not `extension.ts`: the slice rules allow only `index` and
  `main` at the root of `src`.
- **Unit tests run against a stub of `vscode`**, `test/vscode.stub.ts`, mapped by
  Jest's `moduleNameMapper` or Vitest's `alias`. The real module exists only
  inside the extension host. The stub covers the sample and grows with your code.
- **`package`** writes `dist/drop/<name>.vsix` with `vsce package
  --no-dependencies` (mandatory with hoisted npm workspaces).
- **`--sidecar <go-app>`** ships a native binary. `package` then runs the Go app's
  `build-all` with `VERSION` set to the extension's version, and writes one `.vsix`
  per Marketplace target, `dist/drop/<name>-<target>.vsix`, with that platform's
  binary in `bin/`: `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`,
  `darwin-x64`, `darwin-arm64`, plus `alpine-x64`/`alpine-arm64` from the static
  Linux binaries. Unix file modes survive into the package, so the binary stays
  executable. Resolve it at runtime from `context.extensionPath` + `bin/`.
- **`nx-release-publish`** runs `vsce publish --packagePath <every vsix>
  --skip-duplicate` with a Marketplace credential, and skips with a message without
  one. It depends on `package`, so it ships the version `nx release` just wrote. Two
  credentials work, and Entra ID wins when both are configured:
  - **Microsoft Entra ID, no secret (GitHub Actions).** When the `AZURE_CLIENT_ID`
    and `AZURE_TENANT_ID` repository variables exist, the release job signs in with
    `azure/login` through OIDC (`id-token: write`) and publishes with
    `vsce publish --azure-credential`. Nothing is stored and nothing expires. Setup
    is below.
  - **`VSCE_PAT`**, a Marketplace personal access token as a CI secret, in both
    providers. Creating one needs an Azure DevOps organization, which now needs an
    Azure subscription, and global PATs are reported to retire on 2026-12-01. Azure
    Pipelines has only this route for now.
- **Debugging**: an `<name>: debug` launch entry (`extensionHost`) opens a second
  VS Code window with the extension loaded, after the `<name>: build (development)`
  task, which keeps source maps.

Both targets run `tools/vscode-extension.cjs`, a workspace file mnci owns (like
`tools/csharp-version-actions.cjs`): `mnci add vscode-extension` writes it and
`mnci upgrade` rewrites it. It resolves `vsce` and `nx` through their own
`package.json` `bin` and runs them with `node`, with no shell, so a workspace path
containing spaces works on Windows.

### Publishing with Microsoft Entra ID (one-time setup)

Think of it as a guest list rather than a key. GitHub vouches for "a job in
`<owner>/<repo>` on `main`", Entra ID checks that against the federated credential
and issues a short-lived token, and the Marketplace accepts the token because the
identity is a member of the publisher.

1. **A tenant.** A free Azure account creates one. No billable resource is needed.
2. **An app registration** (Entra admin center → App registrations → New
   registration, single tenant, no redirect URI). Prefer it to a managed identity:
   it lives in the tenant, not a subscription, so a lapsed trial does not stop
   publishing. Note its Application (client) ID and Directory (tenant) ID.
3. **A federated credential** on it (Certificates & secrets → Federated
   credentials → GitHub Actions deploying Azure resources): your owner and
   repository, entity type *Branch*, branch `main`. Repositories created after
   2026-07-15 (or opted in) send GitHub's immutable subject, which carries the
   numeric IDs: `repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:refs/heads/main`.
   The form asks for both IDs; `GET /repos/<owner>/<repo>` returns them as
   `owner.id` and `id`.
4. **Repository variables** (Settings → Secrets and variables → Actions →
   Variables, not Secrets): `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`.
5. **The identity as a publisher member.** The Marketplace's Members page wants
   the identity's Azure DevOps profile ID, which only the identity can read, so read
   it from a workflow run on `main` after `azure/login`:
   `az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me
   --resource 499b84ac-1321-427f-aa17-267ca6975798 --query id -o tsv`. Add that ID
   under Members with the **Contributor** role, then confirm with
   `npx @vscode/vsce verify-pat --azure-credential <publisher>` in the same job.

Not built yet: integration tests through `@vscode/test-cli` (they download VS Code
and need a display, so they would be gated like the Go and Flutter sections).

## Flutter (`@mnci/nx-flutter` — one root `pubspec.yaml` pub workspace)

Requires the **Flutter SDK** (3.27+, for Dart 3.6+ pub workspaces) on the
machine; `mnci add flutter-*` fails fast with an install link when `flutter` is
not on the `PATH`. Unlike Python and Go, the SDK is **not** present on hosted
build agents, so the generated pipeline installs it itself (see below).

| Kind                   | Location          | Build / deploy                                                                                        |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `flutter-app`          | `apps/<name>`     | `flutter build web` bundle into `dist/apps/<name>/`, zipped into `dist/drop/flutter-app-<name>.zip`   |
| `flutter-lib`          | `packages/<name>` | publishable **by git tag** — see below; analyze + test targets only                                   |
| `flutter-internal-lib` | `libs/<name>`     | private shared code, analyze + test only — a Dart package is compiled into whatever app depends on it |

- **Dependencies are central, via a Dart pub workspace.** One root
  `pubspec.yaml` lists every project under `workspace:`, and each project
  carries `resolution: workspace`. A single `flutter pub get` at the root then
  resolves the whole graph into **one** `pubspec.lock` and **one**
  `.dart_tool/package_config.json` — pub actively deletes any per-package
  copies. This is the Flutter half of the same root-manifest model as the root
  `package.json` for TS, `requirements-dev.txt` for Python and `go.mod` for Go.
- **An internal library is consumed with a plain version constraint — no
  `path:`.** `dependencies: { core: ^0.0.1 }` resolves to the local package
  because it is a workspace member. That is also why Flutter needs **no
  vendoring step**: contrast `mnci add python-vendor`, which exists only
  because pip cannot bundle an unpublished sibling into a wheel. Flutter is in
  the Go camp here — nothing to weave in at build time.
- **Lint configuration is central too.** The workspace root owns one
  `analysis_options.yaml` (including `package:flutter_lints/flutter.yaml`), and
  each project's own file is a one-line relative `include:` of it, so a rule
  change lands in one place.
- **`flutter analyze --fatal-infos`, pinned explicitly.** `flutter analyze`
  already defaults `--fatal-infos` on — verified against 3.44.8, where
  `--no-fatal-infos` turns a failing lint run green. It is passed anyway
  because that default is the only thing making this a real gate: nearly every
  `flutter_lints` rule reports at _info_ severity. Worth knowing that plain
  `dart analyze` defaults the opposite way (it fails on errors and warnings but
  not infos), so swapping the command without carrying the flag across would
  silently stop enforcing anything.
- **Publishing a `flutter-lib` is a git tag, not a registry upload.** Azure
  Artifacts has no pub/Dart feed type, so a private pub registry is not
  available on this stack, and these packages are deliberately not pushed to
  pub.dev. `nx release` versions and tags them; no `nx-release-publish` target
  is written.
- **The publishable lib carries a `versionActions` override, and it is
  load-bearing.** Nx's default reads a `package.json`, which a Dart package
  does not have. Without the override `nx release` aborts while building the
  release graph — taking down the release of **every** project in the
  workspace, not just the Dart one. The plugin's `library` generator stamps
  `@mnci/nx-flutter/release/version-actions` on, which reads and writes
  `pubspec.yaml`'s `version:`.
- **Apps build for web only.** Web needs nothing beyond the Flutter SDK,
  whereas an Android build would drag the whole Android SDK and NDK onto every
  build agent. Other platforms can be added per-app later with
  `flutter create --platforms=...`.
- **CI** installs the SDK by shallow `git clone` at a pinned tag — Flutter's own
  documented install method, and the only one uniform across agents (the
  release archives differ by platform). It is cloned **outside** the workspace,
  under the agent's home directory: the SDK ships dozens of its own
  `pubspec.yaml` files, which inside the tree would pollute pub's resolution and
  give Nx thousands of extra files to glob. The SDK version is **pinned**
  (as is `golangci-lint`'s) because it determines the Dart version,
  and pub workspaces need Dart 3.6+. Three guarded steps precede the build —
  install, add to `PATH`, and one root `flutter pub get` — and all three skip
  cleanly when the workspace has no root `pubspec.yaml`; the install also skips

## C# (`dotnet new` directly — `@nx/dotnet` is inference-only)

Requires the **.NET SDK** on the machine and on the build agent; `mnci add
csharp-*` fails fast with an install link when `dotnet` is not on the `PATH`.
There is no third-party Nx plugin here the way there is for Go or Flutter:
`@nx/dotnet` was checked directly (packed and read, not assumed maintained) and
ships **no `generators.json`** — it is inference-only, reading an existing
`.csproj` rather than creating one. So every kind below scaffolds via
`dotnet new` and writes its own `project.json` explicitly, the same posture Go
already takes for its single-module layout.

| Kind                   | Location          | Build / deploy                                                                                                    |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `csharp-app`            | `apps/<name>`     | `dotnet build`/`publish` into `dist/apps/<name>/`, zipped into `dist/drop/csharp-app-<name>.zip`                   |
| `csharp-function-app`   | `apps/<name>`     | Azure Functions, .NET **isolated worker**; same build, zipped into `dist/drop/csharp-function-app-<name>.zip`     |
| `csharp-lib`            | `packages/<name>` | publishable to **NuGet** — see below; build + test targets                                                        |
| `csharp-internal-lib`   | `libs/<name>`     | private shared code, build + test only, consumed via a real MSBuild `<ProjectReference>`                          |

- **`nx release` needed no new npm package.** Nx's own version-actions
  resolution (`resolveVersionActionsPath`, read directly from its source
  rather than assumed) tries `require.resolve` as a package specifier first,
  then falls back to a **workspace-relative** path. So `csharp-lib` gets a
  plain `tools/csharp-version-actions.cjs` written into the generated
  workspace itself, extending Nx's real `VersionActions` and reading/writing
  the sole `.csproj`'s `<Version>` element — no publish, no registry, nothing
  beyond a file already sitting in the workspace tree.
- **The `nx-release-publish` target is always present, and gates itself at
  runtime.** Nx throws for the whole release group if *zero* projects carry
  the literal `nx-release-publish` target name, so `csharp-lib` always gets
  one (`dotnet pack` then `dotnet nuget push`), regardless of registry
  choice. It checks `process.env.NUGET_PAT` only when it actually runs,
  printing "NuGet publish is not configured for this registry choice —
  skipping" and exiting 0 when unset, rather than the target being
  conditional at generation time.
- **`nuget.config` mirrors `.npmrc`'s design.** A `--registry npm` workspace
  gets `nuget.org` only, with no credentials — same honest "there is nothing
  to route" reasoning the npm variant uses. A `--registry azure-artifacts`
  workspace registers the feed under the fixed source key `AzureArtifacts`
  (never the real feed name, so the publish target needs no registry
  specifics baked in at generation time) with `packageSourceCredentials`
  referencing `%NUGET_PAT%` — NuGet's environment-variable substitution
  syntax on every platform (`${VAR}`/`$VAR` resolve on none of
  nuget.exe/dotnet.exe/Windows/Mac; verified against Microsoft's own docs).
  The same base64 `PAT` secret npm and twine already use is decoded to the
  raw token NuGet needs.
- **Cross-project references are real MSBuild, not a workspace trick.** A
  `csharp-app` or `csharp-internal-lib` consumer adds a sibling with
  `dotnet add <proj> reference <sibling proj>`, which writes an ordinary
  `<ProjectReference Include="..." />` element — there is no npm-style
  symlinking or a Dart pub workspace's shared resolution to lean on here.
- **`mnci sync`/`mnci up` cover NuGet too.** `<PackageReference>` versions are
  read from every `.csproj`, and the latest-version lookup shells out to
  `dotnet package search --exact-match --format json` — consulting whatever
  sources the workspace's own `nuget.config` resolves, the same
  "go through the ecosystem's own tool" rule `npm view`/`pip index versions`
  already follow, so a private feed's auth just works with no extra code.
  Unlike npm or pub, NuGet has no single workspace-wide resolved version to
  report: each `.csproj` restores independently into its own
  `obj/project.assets.json`, so `mnci sync`'s "resolved version" column is
  honestly empty for this ecosystem.
- **`build` and `test` are pure `@nx/dotnet` inference, not mnci-written
  targets** — the plugin discovers both live from each `.csproj`, the same
  way `lint`/`typecheck` are inferred for TS projects from `eslint.config.mjs`
  and `tsconfig.json`. C# has neither a `lint` nor a `typecheck` target: the
  workspace's `nx run-many -t lint,typecheck,test,build` step simply skips
  both for a C# project the same clean way it already skips `typecheck` for
  a Go or Flutter one — `dotnet build`'s own compiler is the correctness
  check. `PACK_APPS_GUARD` detects `.csproj`-based apps for the drop-zip step
  the same way it detects Go and Node ones.
  when an SDK is already available.
