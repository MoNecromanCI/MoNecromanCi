import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { locateProjects } from '../dependency-management'
import { fileExists, readJson } from '../file-system'
import { runCapture } from '../nx-workspace'
import { locateStrandedReleaseTags } from '../workspace-diagnostics'
import type { RepositoryFacts } from './adoption-report.contract'

/** The lockfile each package manager writes, in the order they are looked for. */
const LOCKFILES: readonly (readonly [string, NonNullable<RepositoryFacts['packageManager']>])[] = [
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

/** Root files a person writes instructions for their own repository in. */
const PERSONAL_FILES: readonly string[] = ['CLAUDE.md', 'AGENTS.md']

/** Config files of tooling mnci has retired. */
const RETIRED_FILE_PATTERN = /^(?:\.prettierrc.*|\.prettierignore|\.oxfmtrc\.json|oxlint\.config\.ts)$/

/** Dependencies and script words of tooling mnci has retired. */
const RETIRED_NAMES: readonly string[] = ['prettier', 'oxfmt', 'oxlint', 'verdaccio']

/**
 * Where a root manifest's retired tooling shows: dependencies and scripts.
 *
 * @param manifest - The parsed root `package.json`.
 * @returns The retired names it mentions.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function retiredNamesIn (manifest: { dependencies?: Record<string, string>, devDependencies?: Record<string, string>, scripts?: Record<string, string> }): string[] {
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  const scripts = Object.values(manifest.scripts ?? {}).join(' ')

  return RETIRED_NAMES.filter(name => declared.includes(name) || new RegExp(String.raw`\b${name}\b`).test(scripts))
}

/**
 * Reads the facts `mnci adopt` judges from a repository, changing nothing.
 *
 * @remarks
 * Git and the filesystem only: no Nx, no network, no install, so the report is quick and safe on
 * any repository. A repository that is not a git work tree reports no tags and no changes rather than failing.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @returns What it holds.
 * @throws Error when a manifest it must read is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function inspectRepository (repositoryRoot: string): RepositoryFacts {
  const inside = runCapture('git', ['rev-parse', '--is-inside-work-tree'], repositoryRoot)
  const isGitRepo = inside.status === 0 && inside.stdout.trim() === 'true'
  const dirty = isGitRepo && runCapture('git', ['status', '--porcelain'], repositoryRoot).stdout.trim() !== ''
  const tags = isGitRepo ? runCapture('git', ['tag', '--list'], repositoryRoot).stdout.split(/\r?\n/).filter(Boolean) : []

  const manifestPath = join(repositoryRoot, 'package.json')
  const manifest = fileExists(manifestPath)
    ? readJson<{ dependencies?: Record<string, string>, devDependencies?: Record<string, string>, scripts?: Record<string, string> }>(manifestPath)
    : {}
  const nxJsonPath = join(repositoryRoot, 'nx.json')
  const nxJson = fileExists(nxJsonPath)
    ? readJson<{ mnci?: unknown, release?: { releaseTag?: { pattern?: string } } }>(nxJsonPath)
    : {}

  const ci: RepositoryFacts['ci'] = []
  const pipelines: string[] = []
  if (existsSync(join(repositoryRoot, 'azure-pipelines.yml'))) {
    ci.push('azure')
    pipelines.push(join(repositoryRoot, 'azure-pipelines.yml'))
  }
  const workflows = join(repositoryRoot, '.github', 'workflows')
  if (existsSync(workflows)) {
    const files = readdirSync(workflows).filter(file => /\.ya?ml$/.test(file))
    if (files.length > 0) {
      ci.push('github')
      pipelines.push(...files.map(file => join(workflows, file)))
    }
  }

  const rootFiles = readdirSync(repositoryRoot)

  return {
    isGitRepo,
    dirty,
    packageManager:   LOCKFILES.find(([file]) => rootFiles.includes(file))?.[1],
    nxVersion:        manifest.devDependencies?.nx ?? manifest.dependencies?.nx,
    alreadyMnci:      nxJson.mnci !== undefined,
    projects:         locateProjects(repositoryRoot).map(({ name, dir, ecosystem }) => ({ name, dir, ecosystem })),
    tagCount:         tags.length,
    strandedTags:     isGitRepo ? locateStrandedReleaseTags(repositoryRoot, nxJson.release?.releaseTag?.pattern) : [],
    ci,
    pipelineUsesMnci: pipelines.some(file => /\bmnci ci\b/.test(readFileSync(file, 'utf8'))),
    retiredTooling:   [...new Set([...rootFiles.filter(file => RETIRED_FILE_PATTERN.test(file) || file === '.verdaccio'), ...retiredNamesIn(manifest)])],
    personalFiles:    PERSONAL_FILES.filter(file => rootFiles.includes(file)),
  }
}
