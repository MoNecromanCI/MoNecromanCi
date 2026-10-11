import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { runShell } from '../nx-workspace'
import { logger } from '../terminal'
import {
  addMavenDependency,
  mavenModuleIdentity,
  parseMavenCoordinate,
  removeMavenDependency,
} from './maven-dependency.algorithm'
import { latestMavenRelease } from './maven-release-lookup.client'
import type { ProjectLocation } from './manifest.repository'

/** Compiles a module with the siblings it depends on, which is what fetches its dependencies. */
function resolve (workspaceRoot: string, location: ProjectLocation): void {
  const arguments_ = ['-B', '-ntp', '-q', '-pl', location.dir, '-am', 'compile']
  logger.step(`${location.dir}: mvn ${arguments_.join(' ')}`)
  if (runShell('mvn', arguments_, workspaceRoot) !== 0) {
    logger.warn(`mvn failed in ${location.dir}: a dependency may not exist, or may not be reachable (a private feed is read from settings.xml by mvn itself)`)
  }
}

/**
 * Keeps the consumer's `project.json` `implicitDependencies` in step with a sibling module it depends on.
 *
 * @remarks
 * Nx infers no edge from a `pom.xml` (`@nx/maven` is not installed), so without this an app is not affected by a change to
 * the library it uses and `nx affected` skips it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The consuming module.
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
 * Adds dependencies to one Maven module: a sibling module by its project name, anything else by its coordinate.
 *
 * @remarks
 * Maven has no "add to the manifest" verb, so this edits the module's own `<dependencies>` (as pip's path does for
 * `pyproject.toml`) and then compiles, which downloads what was named. A coordinate is `group:artifact`, with the version
 * after `@` or a second colon; with no version the newest release on Maven Central is written. A sibling's version is the one
 * its own `pom.xml` declares, which the reactor resolves with no `install`. `--save-dev` writes `<scope>test</scope>`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The Maven module that gains the dependencies.
 * @param packages - The coordinates or sibling names to add; empty restores the module.
 * @param saveDev - Whether to declare them with the `test` scope.
 * @param locations - Every project of the workspace.
 * @returns Nothing; sets `process.exitCode` to 1 for a name that is neither a sibling nor a coordinate.
 * @throws Never - an unreadable file is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function addMavenDependencies (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  saveDev: boolean,
  locations: readonly ProjectLocation[],
): void {
  if (packages.length === 0) {
    resolve(workspaceRoot, location)

    return
  }
  const siblings = new Map(
    locations
      .filter(candidate => candidate.ecosystem === 'maven' && candidate.dir !== location.dir)
      .map(candidate => [candidate.name, candidate] as const),
  )
  for (const specifier of packages) {
    const sibling = siblings.get(specifier)
    const coordinate = sibling === undefined ? parseMavenCoordinate(specifier) : undefined
    let dependency: { groupId: string, artifactId: string, version: string } | undefined
    if (sibling !== undefined) {
      dependency = mavenModuleIdentity(readFileSync(sibling.manifestPath, 'utf8'))
    } else if (coordinate === undefined) {
      logger.warn(`${specifier} is neither a Maven project of this workspace nor a coordinate (group:artifact or group:artifact@version).`)
      process.exitCode = 1

      continue
    } else {
      const version = coordinate.version ?? latestMavenRelease(coordinate.groupId, coordinate.artifactId, workspaceRoot)
      if (version === undefined) {
        logger.warn(`Could not find a release of ${coordinate.groupId}:${coordinate.artifactId} on Maven Central. Give the version: ${coordinate.groupId}:${coordinate.artifactId}@<version>`)
        process.exitCode = 1

        continue
      }
      dependency = { groupId: coordinate.groupId, artifactId: coordinate.artifactId, version }
    }
    if (dependency === undefined) {
      logger.warn(`Could not read the coordinates of ${specifier} from its pom.xml`)
      process.exitCode = 1

      continue
    }
    const text = readFileSync(location.manifestPath, 'utf8')
    const next = addMavenDependency(text, { ...dependency, ...(saveDev && { scope: 'test' }) })
    if (next === text) {
      logger.info(`${dependency.groupId}:${dependency.artifactId} is already declared in ${location.dir} — left as is`)
    } else {
      writeFileEnsured(location.manifestPath, next)
      logger.step(`${location.dir}: added ${dependency.groupId}:${dependency.artifactId}:${dependency.version}${saveDev ? ' (test)' : ''}`)
    }
    if (sibling !== undefined) {
      setImplicitDependency(workspaceRoot, location, sibling.name, true)
    }
  }
  resolve(workspaceRoot, location)
}

/**
 * Removes dependencies from one Maven module's own `<dependencies>`.
 *
 * @remarks
 * By `group:artifact` or by an artifact id that names exactly one declared dependency. A removed sibling also leaves the
 * module's `implicitDependencies`, so the graph stops listing an edge the pom no longer has. Nothing downloads on a removal.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The Maven module that loses the dependencies.
 * @param packages - The coordinates or artifact ids to remove.
 * @returns Nothing; sets `process.exitCode` to 1 for a name that matched nothing, or more than one.
 * @throws Never - an unreadable file is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeMavenDependencies (workspaceRoot: string, location: ProjectLocation, packages: readonly string[]): void {
  for (const name of packages) {
    const text = readFileSync(location.manifestPath, 'utf8')
    const result = removeMavenDependency(text, name)
    if (!result.removed) {
      logger.warn(`${name} is not declared in ${location.dir}, or names more than one dependency (use group:artifact)`)
      process.exitCode = 1

      continue
    }
    writeFileEnsured(location.manifestPath, result.text)
    logger.step(`${location.dir}: removed ${name}`)
    const artifactId = parseMavenCoordinate(name)?.artifactId ?? name
    setImplicitDependency(workspaceRoot, location, artifactId, false)
  }
}
