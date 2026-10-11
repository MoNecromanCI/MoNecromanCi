import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { runShell } from '../nx-workspace'
import { logger } from '../terminal'
import { singleQuoteGemLines } from './gemfile-quotes.algorithm'
import type { ProjectLocation } from './manifest.repository'

/** Runs Bundler in a project's directory, warning (not throwing) on a failure. */
function bundle (workspaceRoot: string, location: ProjectLocation, arguments_: readonly string[]): boolean {
  logger.step(`${location.dir}: bundle ${arguments_.join(' ')}`)
  if (runShell('bundle', [...arguments_], join(workspaceRoot, location.dir)) !== 0) {
    logger.warn(`bundle ${arguments_.join(' ')} failed in ${location.dir}`)

    return false
  }

  return true
}

/**
 * Rewrites the `Gemfile` Bundler just wrote so it passes the workspace's RuboCop.
 *
 * @param location - The project whose `Gemfile` changed.
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when the file cannot be read or written.
 * @typeParam None - this function has no generic type parameters.
 */
function normaliseGemfile (workspaceRoot: string, location: ProjectLocation): void {
  const path = join(workspaceRoot, location.dir, 'Gemfile')
  const text = readFileSync(path, 'utf8')
  const next = singleQuoteGemLines(text)
  if (next !== text) {
    writeFileEnsured(path, next)
  }
}

/**
 * Keeps the consumer's `project.json` `implicitDependencies` in step with a sibling gem it uses.
 *
 * @remarks
 * Nx infers no edge from a `Gemfile`, so without this an app is not affected by a change to the library it uses.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The consuming project.
 * @param sibling - The sibling project's name.
 * @param present - Whether the edge should exist.
 * @returns Nothing.
 * @throws Error when `project.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
function setImplicitDependency (workspaceRoot: string, location: ProjectLocation, sibling: string, present: boolean): void {
  const path = join(workspaceRoot, location.dir, 'project.json')
  if (!fileExists(path)) {
    return
  }
  const project = readJson<{ implicitDependencies?: string[] } & Record<string, unknown>>(path)
  const current = project.implicitDependencies ?? []
  const next = present ? [...new Set([...current, sibling])] : current.filter(name => name !== sibling)
  if (next.length === current.length && next.every((name, index) => name === current[index])) {
    return
  }
  const { implicitDependencies: _previous, ...rest } = project
  writeFileEnsured(path, toJson(next.length > 0 ? { ...rest, implicitDependencies: next } : rest))
}

/**
 * Adds gems to one Ruby project with `bundle add`.
 *
 * @remarks
 * Bundler has the verb, run in the project's directory so it edits that project's `Gemfile` and `Gemfile.lock`. A sibling
 * project is named by its project name (which is its gem name) and added with `--path`, relative to the consumer, plus an
 * `implicitDependencies` edge. `--save-dev` is `--group development`. A gem may carry a version as `name@1.2.3`, which is
 * Bundler's `--version`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The Ruby project that gains the gems.
 * @param packages - The gem names or sibling project names; empty restores the project (`bundle install`).
 * @param saveDev - Whether to add them to the `development` group.
 * @param locations - Every project of the workspace.
 * @returns Nothing.
 * @throws Never - a failed Bundler call is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function addBundlerGems (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  saveDev: boolean,
  locations: readonly ProjectLocation[],
): void {
  if (packages.length === 0) {
    bundle(workspaceRoot, location, ['install'])

    return
  }
  const siblings = new Map(
    locations
      .filter(candidate => candidate.ecosystem === 'bundler' && candidate.dir !== location.dir)
      .map(candidate => [candidate.name, candidate] as const),
  )
  const group = saveDev ? ['--group', 'development'] : []
  for (const specifier of packages) {
    const sibling = siblings.get(specifier)
    if (sibling === undefined) {
      const [gem, version] = specifier.split('@', 2) as [string, string | undefined]
      if (bundle(workspaceRoot, location, ['add', gem, ...(version === undefined ? [] : ['--version', version]), ...group])) {
        normaliseGemfile(workspaceRoot, location)
      }

      continue
    }
    const path = relative(join(workspaceRoot, location.dir), join(workspaceRoot, sibling.dir)).split(sep).join('/')
    if (bundle(workspaceRoot, location, ['add', sibling.name, '--path', path, ...group])) {
      normaliseGemfile(workspaceRoot, location)
      setImplicitDependency(workspaceRoot, location, sibling.name, true)
    }
  }
}

/**
 * Removes gems from one Ruby project with `bundle remove`.
 *
 * @remarks
 * A removed sibling's `implicitDependencies` edge goes with it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The Ruby project that loses the gems.
 * @param packages - The gem names to remove.
 * @param locations - Every project of the workspace.
 * @returns Nothing.
 * @throws Never - a failed Bundler call is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeBundlerGems (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  locations: readonly ProjectLocation[],
): void {
  for (const gem of packages) {
    const removed = bundle(workspaceRoot, location, ['remove', gem])
    const isSibling = locations.some(candidate => candidate.ecosystem === 'bundler' && candidate.name === gem && candidate.dir !== location.dir)
    if (removed && isSibling) {
      setImplicitDependency(workspaceRoot, location, gem, false)
    }
  }
}
