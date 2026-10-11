import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { runShell } from '../nx-workspace'
import { logger } from '../terminal'
import {
  addPathRepository,
  caretConstraint,
  composerIdentity,
  removePathRepository,
} from './composer-manifest.algorithm'
import type { ProjectLocation } from './manifest.repository'

/** Runs Composer in a project with the flags that keep it non-interactive, warning (not throwing) on a failure. */
function composer (workspaceRoot: string, location: ProjectLocation, arguments_: readonly string[]): boolean {
  const full = ['--no-interaction', '--no-progress', ...arguments_, `--working-dir=${location.dir}`]
  logger.step(`${location.dir}: composer ${arguments_.join(' ')}`)
  if (runShell('composer', full, workspaceRoot) !== 0) {
    logger.warn(`composer ${arguments_.join(' ')} failed in ${location.dir}`)

    return false
  }

  return true
}

/**
 * Keeps the consumer's `project.json` `implicitDependencies` in step with a sibling package it requires.
 *
 * @remarks
 * Nx infers no edge from a `composer.json`, so without this an app is not affected by a change to the library it uses.
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
 * Adds packages to one PHP project: a sibling project by its name, anything else by its Composer package name.
 *
 * @remarks
 * Composer has the verb, so `composer require` does the work, in the project's own directory and `vendor/`. A sibling is
 * declared first as a `path` repository (written by text, since quoting JSON through a Windows shell is not worth it) and
 * then required at the caret of the version it declares. `--save-dev` is `--dev`. A package is `vendor/name` or
 * `vendor/name:constraint`, which is Composer's own spelling.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The PHP project that gains the packages.
 * @param packages - The package names or sibling project names; empty restores the project (`composer install`).
 * @param saveDev - Whether to require them in `require-dev`.
 * @param locations - Every project of the workspace.
 * @returns Nothing.
 * @throws Never - a failed Composer call is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function addComposerPackages (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  saveDev: boolean,
  locations: readonly ProjectLocation[],
): void {
  if (packages.length === 0) {
    composer(workspaceRoot, location, ['install'])

    return
  }
  const siblings = new Map(
    locations
      .filter(candidate => candidate.ecosystem === 'composer' && candidate.dir !== location.dir)
      .map(candidate => [candidate.name, candidate] as const),
  )
  const devFlag = saveDev ? ['--dev'] : []
  for (const specifier of packages) {
    const sibling = siblings.get(specifier)
    if (sibling === undefined) {
      composer(workspaceRoot, location, ['require', ...devFlag, specifier])

      continue
    }
    const identity = composerIdentity(readFileSync(sibling.manifestPath, 'utf8'))
    if (identity === undefined) {
      logger.warn(`Could not read the package name of ${sibling.dir}/composer.json`)
      process.exitCode = 1

      continue
    }
    const version = identity.version ?? '0.0.0'
    const relativePath = relative(join(workspaceRoot, location.dir), join(workspaceRoot, sibling.dir)).split(sep).join('/')
    const text = readFileSync(location.manifestPath, 'utf8')
    writeFileEnsured(location.manifestPath, addPathRepository(text, relativePath, identity.name, version))
    if (composer(workspaceRoot, location, ['require', ...devFlag, `${identity.name}:${caretConstraint(version)}`])) {
      setImplicitDependency(workspaceRoot, location, sibling.name, true)
    }
  }
}

/**
 * Removes packages from one PHP project with `composer remove`.
 *
 * @remarks
 * A sibling is named by its project name or its package name; its `path` repository and its `implicitDependencies` edge
 * go with it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The PHP project that loses the packages.
 * @param packages - The package names or sibling project names to remove.
 * @param locations - Every project of the workspace.
 * @returns Nothing.
 * @throws Never - a failed Composer call is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeComposerPackages (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  locations: readonly ProjectLocation[],
): void {
  for (const specifier of packages) {
    const sibling = locations.find(candidate => candidate.ecosystem === 'composer' && candidate.dir !== location.dir && (candidate.name === specifier || composerIdentity(readFileSync(candidate.manifestPath, 'utf8'))?.name === specifier))
    const siblingName = sibling === undefined ? undefined : composerIdentity(readFileSync(sibling.manifestPath, 'utf8'))?.name
    const packageName = siblingName ?? specifier
    const removed = composer(workspaceRoot, location, ['remove', packageName])
    if (!removed || sibling === undefined) {
      continue
    }
    const relativePath = relative(join(workspaceRoot, location.dir), join(workspaceRoot, sibling.dir)).split(sep).join('/')
    writeFileEnsured(location.manifestPath, removePathRepository(readFileSync(location.manifestPath, 'utf8'), relativePath))
    setImplicitDependency(workspaceRoot, location, sibling.name, false)
  }
}
