import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { goModulePrefix } from '../go-workspace'
import { nativeSliceCheckTarget, SLICE_CHECK_PATH, SLICE_CHECK_SCRIPT } from '../native-slice-check'
import { runCapture } from '../nx-workspace'
import { logger } from '../terminal'
import { javaGroupId } from './java-example.algorithm'
import {
  GRADLE_CATALOG_PATH,
  GRADLE_PROPERTIES,
  GRADLE_PROPERTIES_PATH,
  GRADLE_SETTINGS_PATH,
  GRADLE_PROJECTS_END,
} from './kotlin-build.config'
import {
  addGradleProject,
  gradleCatalog,
  gradleSettings,
  kotlinBuildFile,
  kotlinEmptyFiles,
  kotlinExampleFiles,
  type KotlinKind,
} from './kotlin-example.algorithm'
import { wireKotlinLibRelease } from './kotlin-release.use-case'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/** Where each kind's project lives: apps under `apps/`, publishable libraries under `packages/`, private ones under `libs/`. */
const KOTLIN_DIRECTORIES: Readonly<Record<KotlinKind, string>> = {
  'kotlin-app':          'apps',
  'kotlin-lib':          'packages',
  'kotlin-internal-lib': 'libs',
}

/** The Gradle invocation every target shares: plain output, from the workspace root. */
const GRADLE = 'gradle --console=plain'

/**
 * The targets of a Kotlin project, written explicitly because nothing infers them.
 *
 * @remarks
 * Each task runs from the workspace root against the project's Gradle path (`:<name>`), so a project that depends on a
 * sibling builds it from the same build, with no `install` into a local repository first. Each project builds into its
 * own `dist/gradle/<name>` (set in its `build.gradle.kts`), so nothing lands beside the sources and Nx's output clearing
 * on a cache restore cannot touch another project. `build` is `assemble` (the jar; for an app the distribution too), and
 * it waits for the builds of what the project depends on, as the Java kinds do, so two Gradle runs do not compile the same
 * sibling at once. `lint` is ktlint after the shared `slice-check`. There is no `typecheck`: compiling is the check.
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @param app - Whether the project builds an executable distribution.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function kotlinTargets (name: string, directory: string, app: boolean): Record<string, unknown> {
  const output = `dist/gradle/${name}`
  const inputs = ['default', '^default', '{workspaceRoot}/settings.gradle.kts', `{workspaceRoot}/${GRADLE_CATALOG_PATH}`]
  const targets: Record<string, unknown> = {
    'build': {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['^build'],
      inputs,
      outputs:   [`{workspaceRoot}/${output}`],
      options:   { command: `${GRADLE} :${name}:assemble` },
    },
    'test': {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      inputs,
      options:   { command: `${GRADLE} :${name}:test` },
    },
    'slice-check': nativeSliceCheckTarget('kotlin', directory),
    'lint':        {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['slice-check'],
      inputs:    ['default', `{workspaceRoot}/${GRADLE_CATALOG_PATH}`],
      options:   { command: `${GRADLE} :${name}:ktlintCheck` },
    },
  }
  if (app) {
    targets.start = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: `${GRADLE} -q :${name}:run` },
    }
    targets.package = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/kotlin-app-${name}.zip`],
      options:   { command: `${GRADLE} :${name}:distZip` },
    }
  }

  return targets
}

/**
 * Makes sure the workspace's `.gitignore` ignores Gradle's and Kotlin's working folders.
 *
 * @remarks
 * `.gradle/` holds Gradle's caches and `.kotlin/` the Kotlin plugin's sessions and error reports, both written at the
 * workspace root, and `git add -A` after a build would commit them. Idempotent.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when `.gitignore` cannot be read or written.
 * @typeParam None - this function has no generic type parameters.
 */
function ensureGradleIgnored (workspaceRoot: string): void {
  const path = join(workspaceRoot, '.gitignore')
  const current = fileExists(path) ? readFileSync(path, 'utf8') : ''
  const lines = new Set(current.split('\n').map(line => line.trim()))
  const missing = ['.gradle/', '.kotlin/'].filter(entry => !lines.has(entry) && !lines.has(`/${entry}`))
  if (missing.length === 0) {
    return
  }
  const trimmed = current.replace(/\n+$/, '')
  writeFileEnsured(path, `${trimmed}${trimmed.length > 0 ? '\n\n' : ''}# Added by MoNecromanCI: Gradle and Kotlin working folders.\n${missing.join('\n')}\n`)
}

/**
 * Includes the project in the workspace's `settings.gradle.kts`, writing the Gradle files on the first project.
 *
 * @remarks
 * A settings file with no end marker (one the team rewrote) is left as it is and the include is reported, since guessing
 * where it belongs would change a build mnci does not own.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @returns Nothing.
 * @throws Error when a file cannot be read or written.
 * @typeParam None - this function has no generic type parameters.
 */
function registerKotlinProject (workspaceRoot: string, name: string, directory: string): void {
  const settings = join(workspaceRoot, GRADLE_SETTINGS_PATH)
  if (fileExists(settings)) {
    const text = readFileSync(settings, 'utf8')
    const updated = addGradleProject(text, name, directory)
    if (updated === text && !text.includes(`include(":${name}")`)) {
      logger.warn(`${GRADLE_SETTINGS_PATH} has no ${GRADLE_PROJECTS_END} marker, so ${name} was not included. Add include(":${name}") and project(":${name}").projectDir = file("${directory}") to it.`)
    }
    writeFileEnsured(settings, updated)
  } else {
    writeFileEnsured(settings, gradleSettings(name, directory))
  }
  if (!fileExists(join(workspaceRoot, GRADLE_CATALOG_PATH))) {
    writeFileEnsured(join(workspaceRoot, GRADLE_CATALOG_PATH), gradleCatalog())
  }
  if (!fileExists(join(workspaceRoot, GRADLE_PROPERTIES_PATH))) {
    writeFileEnsured(join(workspaceRoot, GRADLE_PROPERTIES_PATH), GRADLE_PROPERTIES)
  }
}

/**
 * Adds a Kotlin project: a Gradle project with a worked example, explicit targets and, for a library, release by tag.
 *
 * @remarks
 * `@nx/gradle` is inference-only (it ships no project generator), so mnci writes the project as it writes a Java or C++
 * one. A `build.gradle.kts` is a program, so the editable surface is the version catalog plus a dependency block between
 * two marker comments (what `mnci install` writes); a project the team reshaped beyond that is refused, not guessed at.
 * The root `settings.gradle.kts` is mnci's, with an include per project.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param kind - Which Kotlin kind.
 * @param empty - Scaffold a bare project (`--empty`).
 * @returns Nothing.
 * @throws Error when a file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addKotlinProject (workspaceRoot: string, name: string, kind: KotlinKind, empty = false): void {
  const app = kind === 'kotlin-app'
  const directory = `${KOTLIN_DIRECTORIES[kind]}/${name}`
  const projectRoot = join(workspaceRoot, directory)
  if (app) {
    ensureAdmZip(workspaceRoot)
  }
  const group = javaGroupId(goModulePrefix(workspaceRoot))
  registerKotlinProject(workspaceRoot, name, directory)
  ensureGradleIgnored(workspaceRoot)

  writeFileEnsured(join(projectRoot, 'build.gradle.kts'), kotlinBuildFile(kind, group, name))
  const files = empty ? kotlinEmptyFiles(kind, group, name) : kotlinExampleFiles(kind, group, name)
  for (const [relative, contents] of Object.entries(files)) {
    writeFileEnsured(join(projectRoot, relative), contents)
  }
  writeFileEnsured(
    join(projectRoot, 'project.json'),
    `${JSON.stringify({
      name,
      $schema:     '../../node_modules/nx/schemas/project-schema.json',
      projectType: app ? 'application' : 'library',
      sourceRoot:  `${directory}/src/main/kotlin`,
      tags:        [`type:${kind}`],
      targets:     {},
    }, undefined, 2)}\n`,
  )
  writeFileEnsured(join(workspaceRoot, SLICE_CHECK_PATH), SLICE_CHECK_SCRIPT)
  addProjectJsonTargets(join(projectRoot, 'project.json'), kotlinTargets(name, directory, app))
  if (kind === 'kotlin-lib') {
    wireKotlinLibRelease(workspaceRoot, directory, name)
  }
  registerProjectCommands(workspaceRoot, name, app ? { build: true, start: `nx run ${name}:start` } : { build: kind === 'kotlin-lib' })

  if (runCapture('gradle', ['--version'], workspaceRoot).status !== 0) {
    logger.warn('gradle is not on PATH, and every Kotlin target runs it. Install Gradle 8.5 or newer and a JDK 21 (winget, apt, brew, sdkman).')
  }
}
