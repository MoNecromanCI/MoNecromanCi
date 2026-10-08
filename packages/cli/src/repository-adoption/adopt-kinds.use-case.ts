import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { locateProjects, type ProjectLocation } from '../dependency-management'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { runCapture } from '../nx-workspace'
import { PROJECT_KINDS } from '../project-scaffolding'
import { requireCleanWorkingTree } from './clean-working-tree.validator'
import { inferProjectKind, type KindProposal, type ProjectEvidence } from './infer-project-kind.algorithm'

/** The prefix of the tag that records a project's kind. */
const TYPE_TAG = 'type:'

/**
 * What happened to one project in the kinds step.
 *
 * @remarks
 * `tagged` got its `type:<kind>` tag now; `already` had a kind tag and was left alone; `undecided` is a
 * guess nobody confirmed, listed with what was guessed and why so the next run can name it.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface KindOutcome {
  /** The project's directory, workspace-relative. */
  dir:     string
  /** What happened to it. */
  outcome: 'tagged' | 'already' | 'undecided'
  /** The kind that was written, kept or proposed. */
  kind:    string
  /** Why this kind, or what the existing tag was. */
  reason:  string
}

/**
 * What {@link adoptKinds} needs from its environment, so a test can run it without git.
 *
 * @remarks
 * Every member has a real default.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface KindsDependencies {
  /** Runs a command and returns what it printed. */
  capture: (command: string, arguments_: string[], cwd: string) => { status: number, stdout: string }
}

/**
 * Reads what the inference needs from a project's directory.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param location - The project.
 * @returns The evidence.
 * @throws Error when a `package.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function readEvidence (repositoryRoot: string, location: ProjectLocation): ProjectEvidence {
  const directory = join(repositoryRoot, location.dir)
  const files = readdirSync(directory)
  const manifest = location.ecosystem === 'npm' ? readJson<Record<string, unknown>>(location.manifestPath) : {}
  const text = location.ecosystem === 'npm' ? '' : readFileSync(location.manifestPath, 'utf8')
  let hasProgram = false
  if (location.ecosystem === 'go') {
    hasProgram = files.filter(file => file.endsWith('.go')).some(file => /^package main\b/m.test(readFileSync(join(directory, file), 'utf8')))
  } else if (location.ecosystem === 'pub') {
    hasProgram = existsSync(join(directory, 'lib', 'main.dart'))
  }

  return { ecosystem: location.ecosystem, manifest, text, files, hasProgram }
}

/**
 * The `type:*` tag a project already carries, from its `project.json` or the `nx.tags` of its `package.json`.
 *
 * @param directory - Absolute path to the project.
 * @returns The kind, without the prefix, or `undefined`.
 * @throws Error when one of the files is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function existingKind (directory: string): string | undefined {
  const sources: string[][] = []
  if (fileExists(join(directory, 'project.json'))) {
    sources.push(readJson<{ tags?: string[] }>(join(directory, 'project.json')).tags ?? [])
  }
  if (fileExists(join(directory, 'package.json'))) {
    sources.push(readJson<{ nx?: { tags?: string[] } }>(join(directory, 'package.json')).nx?.tags ?? [])
  }

  return sources.flat().find(tag => tag.startsWith(TYPE_TAG))?.slice(TYPE_TAG.length)
}

/**
 * Writes the `type:<kind>` tag where Nx reads project tags for this project.
 *
 * @remarks
 * Into the project's `project.json` when it has one, otherwise into the `nx.tags` of its `package.json`,
 * otherwise a new minimal `project.json`. Other tags and keys are kept as they were.
 *
 * @param directory - Absolute path to the project.
 * @param name - The project's directory name, used for a new `project.json`.
 * @param kind - The kind to record.
 * @returns Nothing.
 * @throws Error when an existing file is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function writeKindTag (directory: string, name: string, kind: string): void {
  const tag = `${TYPE_TAG}${kind}`
  const projectJson = join(directory, 'project.json')
  const packageJson = join(directory, 'package.json')
  if (fileExists(projectJson)) {
    const project = readJson<{ tags?: string[] } & Record<string, unknown>>(projectJson)
    writeFileEnsured(projectJson, toJson({ ...project, tags: [...project.tags ?? [], tag] }))
  } else if (fileExists(packageJson)) {
    const manifest = readJson<{ nx?: { tags?: string[] } & Record<string, unknown> } & Record<string, unknown>>(packageJson)
    writeFileEnsured(packageJson, toJson({ ...manifest, nx: { ...manifest.nx, tags: [...manifest.nx?.tags ?? [], tag] } }))
  } else {
    writeFileEnsured(projectJson, toJson({ name, tags: [tag] }))
  }
}

/**
 * Records the mnci kind of every existing project as a `type:<kind>` tag.
 *
 * @remarks
 * A project whose kind the evidence names outright is tagged. A project where two kinds fit (a library that
 * is internal or published, a script that is an app or a library) is left alone and listed with the proposal
 * and its reason, unless `overrides` names it (`apps/api` to `node-app`): a guess is never applied. A project
 * that already carries a `type:*` tag keeps it. Refuses an unclean git tree, since it edits manifests.
 * No project is regenerated and no target is written: Nx infers the targets of an npm project from its own
 * scripts, and the other kinds get theirs when their generator runs.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param overrides - Kinds the person chose, by project directory.
 * @param dependencies - The process runner; the real one by default.
 * @returns What happened to each project, sorted by directory.
 * @throws Error when the tree is not clean, or an override names an unknown kind or a project that does not exist.
 * @typeParam None - this function has no generic type parameters.
 */
export function adoptKinds (repositoryRoot: string, overrides: Readonly<Record<string, string>> = {}, dependencies: Partial<KindsDependencies> = {}): KindOutcome[] {
  requireCleanWorkingTree(repositoryRoot, dependencies.capture ?? runCapture)
  const locations = locateProjects(repositoryRoot)
  const known = new Set(locations.map(location => location.dir))
  for (const [dir, kind] of Object.entries(overrides)) {
    if (!known.has(dir)) {
      throw new Error(`--kind ${dir}=${kind}: no project at ${dir}. Projects found: ${[...known].join(', ')}`)
    }
    if (!PROJECT_KINDS.includes(kind as never)) {
      throw new Error(`--kind ${dir}=${kind}: ${kind} is not a kind. Kinds: ${PROJECT_KINDS.join(', ')}`)
    }
  }

  return locations.map((location): KindOutcome => {
    const directory = join(repositoryRoot, location.dir)
    const present = existingKind(directory)
    if (present !== undefined) {
      return { dir: location.dir, outcome: 'already', kind: present, reason: PROJECT_KINDS.includes(present as never) ? 'it already has a type tag' : 'it already has a type tag of its own, which is not an mnci kind name; left as it is' }
    }
    const chosen = overrides[location.dir]
    const proposal: KindProposal = chosen === undefined ? inferProjectKind(readEvidence(repositoryRoot, location)) : { kind: chosen, certainty: 'certain', reason: 'named with --kind' }
    if (proposal.certainty === 'guess') {
      return { dir: location.dir, outcome: 'undecided', kind: proposal.kind, reason: proposal.reason }
    }
    writeKindTag(directory, location.name, proposal.kind)

    return { dir: location.dir, outcome: 'tagged', kind: proposal.kind, reason: proposal.reason }
  }).toSorted((a, b) => a.dir.localeCompare(b.dir))
}
