import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { goModulePrefix } from '../go-workspace'
import { nativeSliceCheckTarget, SLICE_CHECK_PATH, SLICE_CHECK_SCRIPT } from '../native-slice-check'
import { runCapture } from '../nx-workspace'
import { logger } from '../terminal'
import {
  AGP_MIN_GRADLE,
  ANDROID_BUILD_TOOLS_PACKAGE,
  ANDROID_PLATFORM_PACKAGE,
} from './android-build.config'
import {
  androidBuildFile,
  androidEditorConfig,
  androidEmptyFiles,
  androidExampleFiles,
  withAndroidCatalog,
  withGoogleRepository,
  type AndroidKind,
} from './android-example.algorithm'
import { javaGroupId } from './java-example.algorithm'
import { GRADLE_CATALOG_PATH, GRADLE_PROPERTIES_PATH, GRADLE_SETTINGS_PATH } from './kotlin-build.config'
import { wireKotlinLibRelease } from './kotlin-release.use-case'
import { ensureGradleIgnored, registerKotlinProject } from './kotlin.use-case'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/** Where each kind's project lives: apps under `apps/`, publishable libraries under `packages/`, private ones under `libs/`. */
const ANDROID_DIRECTORIES: Readonly<Record<AndroidKind, string>> = {
  'android-app':          'apps',
  'android-lib':          'packages',
  'android-internal-lib': 'libs',
}

/** The Gradle invocation every target shares: plain output, from the workspace root. */
const GRADLE = 'gradle --console=plain'

/** The `sdk.dir` line Android Studio writes to `local.properties`. */
const SDK_DIRECTORY = /^\s*sdk\.dir\s*=/m

/** The version line of `gradle --version`. */
const GRADLE_VERSION = /^Gradle (\d+)\.(\d+)(?:\.(\d+))?/m

/**
 * Whether one `major.minor.patch` triple is older than another.
 *
 * @remarks
 * Compared field by field from the major; a missing patch counts as zero.
 *
 * @param actual - The version found.
 * @param needed - The version required.
 * @returns `true` when `actual` is older.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function isOlder (actual: readonly number[], needed: readonly number[]): boolean {
  for (const [index, wanted] of needed.entries()) {
    const have = actual[index] ?? 0
    if (have !== wanted) {
      return have < wanted
    }
  }

  return false
}

/**
 * The targets of an Android project, written explicitly because nothing infers them.
 *
 * @remarks
 * Like the Kotlin kinds', each task runs from the workspace root against the project's Gradle path and builds into
 * `dist/gradle/<name>` (measured: AGP honours `layout.buildDirectory`, so the APK is
 * `dist/gradle/<name>/outputs/apk/debug` and an AAR `dist/gradle/<name>/outputs/aar`). An application builds the debug
 * variant: release signing is the team's, never generated. A library assembles both variants. `test` is the local JVM unit
 * tests only (instrumented tests need a device and are not in this slice). `lint` is ktlint and Android Lint, after the
 * shared `slice-check`, the project's own build and the lint of what it depends on: Android Lint of an application analyses
 * its libraries too, so two Gradle processes in one root would otherwise run `:kit:lintAnalyzeDebug` at once and one fails
 * to read the other's partial results (measured with `nx run-many -t lint`). An application has `package` (the APK into
 * `dist/drop`) and no `start`: running needs a device.
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @param app - Whether the project is an application.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function androidTargets (name: string, directory: string, app: boolean): Record<string, unknown> {
  const output = `dist/gradle/${name}`
  const inputs = ['default', '^default', '{workspaceRoot}/settings.gradle.kts', `{workspaceRoot}/${GRADLE_CATALOG_PATH}`]
  const targets: Record<string, unknown> = {
    'build': {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['^build'],
      inputs,
      outputs:   [`{workspaceRoot}/${output}`],
      options:   { command: `${GRADLE} :${name}:${app ? 'assembleDebug' : 'assemble'}` },
    },
    'test': {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      inputs,
      options:   { command: `${GRADLE} :${name}:testDebugUnitTest` },
    },
    'slice-check': nativeSliceCheckTarget('android', directory),
    'lint':        {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['slice-check', 'build', '^lint'],
      inputs,
      options:   { command: `${GRADLE} :${name}:ktlintCheck :${name}:lintDebug` },
    },
  }
  if (app) {
    targets.package = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/android-app-${name}.apk`],
      options:   { command: `${GRADLE} :${name}:packageApk` },
    }
  }

  return targets
}

/**
 * Prepares the workspace's Gradle files for Android: Google's repository, the catalog entries and a roomier JVM.
 *
 * @remarks
 * The Kotlin kinds write these files with the JVM-only entries; an Android project adds what it needs on top and never
 * replaces a line the team changed. `org.gradle.jvmargs` is raised from the Kotlin default (1 GB) only when it still has
 * that default, because AGP and the Compose compiler run out of it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when a file cannot be read or written.
 * @typeParam None - this function has no generic type parameters.
 */
function prepareAndroidWorkspace (workspaceRoot: string): void {
  const settings = join(workspaceRoot, GRADLE_SETTINGS_PATH)
  const settingsText = readFileSync(settings, 'utf8')
  const withGoogle = withGoogleRepository(settingsText)
  if (withGoogle !== settingsText) {
    writeFileEnsured(settings, withGoogle)
  }
  if (!/\bgoogle\(\)/.test(withGoogle)) {
    logger.warn(`${GRADLE_SETTINGS_PATH} does not resolve from google(). Add google() to pluginManagement and dependencyResolutionManagement repositories, or the Android Gradle Plugin will not be found.`)
  }
  const catalog = join(workspaceRoot, GRADLE_CATALOG_PATH)
  const catalogText = readFileSync(catalog, 'utf8')
  const withEntries = withAndroidCatalog(catalogText)
  if (withEntries !== catalogText) {
    writeFileEnsured(catalog, withEntries)
  }
  const properties = join(workspaceRoot, GRADLE_PROPERTIES_PATH)
  if (fileExists(properties)) {
    const text = readFileSync(properties, 'utf8')
    const raised = text.replace(/^org\.gradle\.jvmargs=-Xmx1g\s*$/m, 'org.gradle.jvmargs=-Xmx2g')
    if (raised !== text) {
      writeFileEnsured(properties, raised)
    }
  }
}

/**
 * Says what the machine lacks to build an Android project, naming the exact command and never running it.
 *
 * @remarks
 * The Android SDK is a large download behind a licence only a person can accept, so mnci detects and names, as it does
 * for `dlv`. Checks the SDK location (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, or `sdk.dir` in `local.properties`) and that
 * Gradle is at the version AGP needs.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Never - every probe failure becomes a warning.
 * @typeParam None - this function has no generic type parameters.
 */
function warnAboutToolchain (workspaceRoot: string): void {
  const localProperties = join(workspaceRoot, 'local.properties')
  const hasSdkDirectory = fileExists(localProperties) && SDK_DIRECTORY.test(readFileSync(localProperties, 'utf8'))
  if (!hasSdkDirectory && (process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT) === undefined) {
    logger.warn(`No Android SDK found (ANDROID_HOME, ANDROID_SDK_ROOT, or sdk.dir in local.properties). Install the command-line tools from developer.android.com/studio, read and accept the licences yourself with 'sdkmanager --licenses', then: sdkmanager "${ANDROID_PLATFORM_PACKAGE}" "${ANDROID_BUILD_TOOLS_PACKAGE}". mnci never accepts a licence for you.`)
  }
  const gradle = runCapture('gradle', ['--version'], workspaceRoot)
  if (gradle.status !== 0) {
    logger.warn(`gradle is not on PATH, and every Android target runs it. The Android Gradle Plugin needs Gradle ${AGP_MIN_GRADLE} or newer and a JDK 17 or newer.`)

    return
  }
  const found = GRADLE_VERSION.exec(gradle.stdout)
  if (found !== null) {
    const actual = [Number(found[1]), Number(found[2]), Number(found[3] ?? 0)]
    if (isOlder(actual, AGP_MIN_GRADLE.split('.').map(Number))) {
      logger.warn(`Gradle ${actual.join('.')} is older than ${AGP_MIN_GRADLE}, which the Android Gradle Plugin this workspace pins needs. Upgrade Gradle before building.`)
    }
  }
}

/**
 * Adds an Android project: a Gradle project with a Compose example, explicit targets and, for a library, release by tag.
 *
 * @remarks
 * Written directly, like the Kotlin kinds, on the same root `settings.gradle.kts` and version catalog (an Android project
 * and a Kotlin one share a workspace and can depend on each other). The Android Gradle Plugin and the Compose BOM are
 * pinned in one place (`android-build.config.ts`) because AGP, Gradle, the build tools and `compileSdk` move together.
 * Not covered: instrumented tests and emulators, signing and Play publishing, the SDK in `mnci ci setup` and the
 * devcontainer, a debug launch.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param kind - Which Android kind.
 * @param empty - Scaffold a bare project (`--empty`).
 * @returns Nothing.
 * @throws Error when a file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addAndroidProject (workspaceRoot: string, name: string, kind: AndroidKind, empty = false): void {
  const app = kind === 'android-app'
  const directory = `${ANDROID_DIRECTORIES[kind]}/${name}`
  const projectRoot = join(workspaceRoot, directory)
  if (app) {
    ensureAdmZip(workspaceRoot)
  }
  const group = javaGroupId(goModulePrefix(workspaceRoot))
  registerKotlinProject(workspaceRoot, name, directory)
  prepareAndroidWorkspace(workspaceRoot)
  ensureGradleIgnored(workspaceRoot, ['local.properties', '/build/'])

  writeFileEnsured(join(projectRoot, 'build.gradle.kts'), androidBuildFile(kind, group, name))
  writeFileEnsured(join(projectRoot, '.editorconfig'), androidEditorConfig())
  const files = empty ? androidEmptyFiles(kind, group, name) : androidExampleFiles(kind, group, name)
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
  addProjectJsonTargets(join(projectRoot, 'project.json'), androidTargets(name, directory, app))
  if (kind === 'android-lib') {
    wireKotlinLibRelease(workspaceRoot, directory, name)
  }
  registerProjectCommands(workspaceRoot, name, { build: app || kind === 'android-lib' })

  warnAboutToolchain(workspaceRoot)
}
