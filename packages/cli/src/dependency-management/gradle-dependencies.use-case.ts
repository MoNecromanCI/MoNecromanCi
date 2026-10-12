import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { runShell } from '../nx-workspace'
import { logger } from '../terminal'
import {
  addCatalogLibrary,
  addDependencyLine,
  catalogAccessor,
  removeCatalogLibrary,
  removeDependencyLines,
} from './gradle-dependency.algorithm'
import { setImplicitDependency } from './implicit-dependency.use-case'
import { parseMavenCoordinate } from './maven-dependency.algorithm'
import { latestMavenRelease } from './maven-release-lookup.client'
import type { ProjectLocation } from './manifest.repository'

/** The version catalog, relative to the workspace root: the declarative surface `mnci install` edits. */
const CATALOG = 'gradle/libs.versions.toml'

/** Compiles the project's main sources, which is what makes Gradle resolve and download its dependencies. */
function resolve (workspaceRoot: string, location: ProjectLocation): void {
  const arguments_ = ['--console=plain', '-q', `:${location.name}:classes`]
  logger.step(`${location.dir}: gradle ${arguments_.join(' ')}`)
  if (runShell('gradle', arguments_, workspaceRoot) !== 0) {
    logger.warn(`gradle failed for ${location.name}: a dependency may not exist, or may not be reachable (a private repository is declared in settings.gradle.kts)`)
  }
}

/**
 * Adds dependencies to one Gradle project: a sibling by its project name, anything else by its Maven coordinate.
 *
 * @remarks
 * A `build.gradle.kts` is a program, so mnci edits only what it wrote: the catalog's `[libraries]` table and the lines
 * between the two marker comments of the project's dependency block. A sibling is `implementation(project(":name"))` with
 * an `implicitDependencies` edge (Nx infers none from a Gradle build). An external library is `group:artifact`, with the
 * version after `@` or a second colon, or the newest Maven Central release when none is given; it is written to the catalog
 * as an alias and used as `libs.<alias>`. A build file without the markers is refused with a message, never guessed at.
 * `--save-dev` writes `testImplementation`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The Gradle project that gains the dependencies.
 * @param packages - The coordinates or sibling names to add; empty restores the project.
 * @param saveDev - Whether to declare them as `testImplementation`.
 * @param locations - Every project of the workspace.
 * @returns Nothing; sets `process.exitCode` to 1 for a name that cannot be added.
 * @throws Never - an unreadable file is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGradleDependencies (
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
  const configuration = saveDev ? 'testImplementation' : 'implementation'
  const siblings = new Map(
    locations
      .filter(candidate => candidate.ecosystem === 'gradle' && candidate.dir !== location.dir)
      .map(candidate => [candidate.name, candidate] as const),
  )
  const catalogPath = join(workspaceRoot, CATALOG)
  for (const specifier of packages) {
    const sibling = siblings.get(specifier)
    const coordinate = sibling === undefined ? parseMavenCoordinate(specifier) : undefined
    if (sibling === undefined && coordinate === undefined) {
      logger.warn(`${specifier} is neither a Gradle project of this workspace nor a coordinate (group:artifact or group:artifact@version).`)
      process.exitCode = 1

      continue
    }
    let line: string
    let described: string
    let catalogText: string | undefined
    if (sibling === undefined && coordinate !== undefined) {
      const version = coordinate.version ?? latestMavenRelease(coordinate.groupId, coordinate.artifactId, workspaceRoot)
      if (version === undefined) {
        logger.warn(`Could not find a release of ${coordinate.groupId}:${coordinate.artifactId} on Maven Central. Give the version: ${coordinate.groupId}:${coordinate.artifactId}@<version>`)
        process.exitCode = 1

        continue
      }
      if (!fileExists(catalogPath)) {
        logger.warn(`${CATALOG} does not exist, and it is where a library is declared. Restore it, or add the dependency by hand.`)
        process.exitCode = 1

        continue
      }
      const added = addCatalogLibrary(readFileSync(catalogPath, 'utf8'), coordinate.groupId, coordinate.artifactId, version)
      catalogText = added.text
      line = `${configuration}(${catalogAccessor(added.alias)})`
      described = `${coordinate.groupId}:${coordinate.artifactId}:${version}`
    } else {
      line = `${configuration}(project(":${specifier}"))`
      described = `project :${specifier}`
    }
    const build = readFileSync(location.manifestPath, 'utf8')
    const edited = addDependencyLine(build, line)
    if (edited.refused) {
      logger.warn(`${location.dir}/build.gradle.kts has no "// mnci:dependencies" block, so ${specifier} was not added. Add ${line} to its dependencies by hand.`)
      process.exitCode = 1

      continue
    }
    if (catalogText !== undefined && catalogText !== readFileSync(catalogPath, 'utf8')) {
      writeFileEnsured(catalogPath, catalogText)
    }
    if (edited.text === build) {
      logger.info(`${described} is already declared in ${location.dir} — left as is`)
    } else {
      writeFileEnsured(location.manifestPath, edited.text)
      logger.step(`${location.dir}: added ${described}${saveDev ? ' (test)' : ''}`)
    }
    if (sibling !== undefined) {
      setImplicitDependency(workspaceRoot, location, sibling.name, true)
    }
  }
  resolve(workspaceRoot, location)
}

/**
 * Removes dependencies from one Gradle project's own dependency block.
 *
 * @remarks
 * By project name (a sibling) or by `group:artifact` or an artifact id that names one library of the catalog. The catalog
 * entry goes too when no other project of the workspace still uses it. A removed sibling also leaves the project's
 * `implicitDependencies`. Nothing downloads on a removal.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The Gradle project that loses the dependencies.
 * @param packages - The coordinates, artifact ids or sibling names to remove.
 * @param locations - Every project of the workspace.
 * @returns Nothing; sets `process.exitCode` to 1 for a name that matched nothing, or more than one.
 * @throws Never - an unreadable file is reported as a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeGradleDependencies (
  workspaceRoot: string,
  location: ProjectLocation,
  packages: readonly string[],
  locations: readonly ProjectLocation[],
): void {
  const catalogPath = join(workspaceRoot, CATALOG)
  for (const name of packages) {
    const build = readFileSync(location.manifestPath, 'utf8')
    const siblingLine = (line: string): boolean => line.includes(`project(":${name}")`)
    const fromSibling = removeDependencyLines(build, [siblingLine])
    if (fromSibling.removed > 0) {
      writeFileEnsured(location.manifestPath, fromSibling.text)
      setImplicitDependency(workspaceRoot, location, name, false)
      logger.step(`${location.dir}: removed project :${name}`)

      continue
    }
    const catalog = fileExists(catalogPath) ? readFileSync(catalogPath, 'utf8') : ''
    const coordinate = parseMavenCoordinate(name)
    const wantedArtifact = coordinate?.artifactId ?? name
    const aliases = catalog
      .split(/\r?\n/)
      .map(line => /^\s*([\w.-]+)\s*=.*module\s*=\s*"([^":]+):([^":]+)"/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .filter(match => match[3] === wantedArtifact && (coordinate === undefined || match[2] === coordinate.groupId))
      .map(match => match[1])
    if (aliases.length !== 1) {
      logger.warn(`${name} is not declared in ${location.dir}, or names more than one library (use group:artifact)`)
      process.exitCode = 1

      continue
    }
    const alias = aliases[0]
    const accessor = catalogAccessor(alias)
    const result = removeDependencyLines(build, [line => line.includes(`(${accessor})`)])
    if (result.removed === 0) {
      logger.warn(`${name} is in the catalog but ${location.dir} does not declare it`)
      process.exitCode = 1

      continue
    }
    writeFileEnsured(location.manifestPath, result.text)
    logger.step(`${location.dir}: removed ${name}`)
    const stillUsed = locations
      .filter(candidate => candidate.ecosystem === 'gradle')
      .some(candidate => readFileSync(candidate.manifestPath, 'utf8').includes(`(${accessor})`))
    if (!stillUsed) {
      writeFileEnsured(catalogPath, removeCatalogLibrary(catalog, alias))
    }
  }
}
