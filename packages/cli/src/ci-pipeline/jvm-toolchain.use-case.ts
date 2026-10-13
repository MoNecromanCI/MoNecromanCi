import { existsSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GRADLE_VERSION, JAVA_VERSION } from '../workspace-overlay'
import { addToPath, exportVariable, type CiHost } from './ci-environment.client'
import type { CiProcesses } from './phase.contract'

/** The folders a Maven module or a Gradle project lives in. */
const PROJECT_ROOTS = ['apps', 'packages', 'libs']

/**
 * What JVM projects a workspace holds.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
interface JvmProjects {
  readonly maven:   boolean
  readonly gradle:  boolean
  readonly android: boolean
}

/**
 * Finds the Maven, Gradle and Android projects of a workspace.
 *
 * @remarks
 * Located by their build files, as `mnci projects` locates them. An Android project is a Gradle one whose build file
 * applies an Android plugin.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Which kinds are present.
 * @throws Never - an unreadable build file is not Android.
 * @typeParam None - this function has no generic type parameters.
 */
function findJvmProjects (workspaceRoot: string): JvmProjects {
  const matching = (file: string): string[] => PROJECT_ROOTS.flatMap(root => globSync(`${root}/*/${file}`, { cwd: workspaceRoot }))
  const buildFiles = matching('build.gradle.kts')
  const android = buildFiles.some(file => {
    try {
      return readFileSync(join(workspaceRoot, file), 'utf8').includes('com.android')
    } catch {
      return false
    }
  })

  return { maven: matching('pom.xml').length > 0, gradle: buildFiles.length > 0, android }
}

/**
 * The numeric major and minor of a version, for a floor comparison.
 *
 * @param text - Text that holds a version, such as the output of `gradle --version`.
 * @returns The two numbers, or `undefined` when none is found.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function majorMinor (text: string): [number, number] | undefined {
  const match = /(\d+)\.(\d+)/.exec(text)

  return match === null ? undefined : [Number(match[1]), Number(match[2])]
}

/**
 * Prepares the JVM toolchain for a workspace with Maven, Gradle or Android projects.
 *
 * @remarks
 * Hosted runners ship several JDKs and name each by `JAVA_HOME_<major>_<ARCH>`; this selects the pinned
 * {@link JAVA_VERSION} for the steps after it (`JAVA_HOME` and `PATH`), so CI builds with the JDK the devcontainer has.
 * Nothing is downloaded: Gradle and Maven come with the hosted images, and one that is missing or older than
 * {@link GRADLE_VERSION} is named in a warning, because the build would fail later with a less direct message. The Android
 * SDK is never installed and its licences never accepted: a missing one is named with the `sdkmanager` commands.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param host - Where the phase is running.
 * @param environment - The process environment.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0: this step informs and selects, it does not fail a build the toolchain itself will judge.
 * @throws Error when a CI environment file cannot be appended to.
 * @typeParam None - this function has no generic type parameters.
 */
export function prepareJvmToolchain (
  workspaceRoot: string,
  host: CiHost,
  environment: NodeJS.ProcessEnv,
  processes: CiProcesses,
  log: (message: string) => void,
): number {
  const projects = findJvmProjects(workspaceRoot)
  if (!projects.maven && !projects.gradle) {
    log('No Java, Kotlin or Android projects - skipping.')

    return 0
  }
  const architecture = process.arch === 'arm64' ? 'ARM64' : 'X64'
  const jdk = environment[`JAVA_HOME_${JAVA_VERSION}_${architecture}`]
  if (jdk !== undefined && jdk !== '' && existsSync(jdk)) {
    exportVariable(host, environment, 'JAVA_HOME', jdk, log)
    addToPath(host, environment, join(jdk, 'bin'), log)
    log(`Selected JDK ${JAVA_VERSION} (${jdk}).`)
  } else if (processes.capture('java', ['-version']).status !== 0) {
    log(`Warning: no JDK ${JAVA_VERSION} was found (JAVA_HOME_${JAVA_VERSION}_${architecture} is unset and java is not on PATH). Install a JDK ${JAVA_VERSION} before the build.`)
  }
  if (projects.gradle) {
    const gradle = processes.capture('gradle', ['--version'])
    const found = gradle.status === 0 ? majorMinor(/^Gradle\s+(\S+)/m.exec(gradle.stdout)?.[1] ?? '') : undefined
    const wanted = majorMinor(GRADLE_VERSION)
    if (gradle.status !== 0) {
      log(`Warning: Gradle was not found on PATH; mnci's projects were verified with Gradle ${GRADLE_VERSION}.`)
    } else if (found !== undefined && wanted !== undefined && (found[0] < wanted[0] || (found[0] === wanted[0] && found[1] < wanted[1]))) {
      log(`Warning: this runner's Gradle ${found.join('.')} is older than ${GRADLE_VERSION}, which the projects were verified with (an Android project needs 9.6 or newer).`)
    }
  }
  if (projects.maven && processes.capture('mvn', ['--version']).status !== 0) {
    log('Warning: Maven was not found on PATH.')
  }
  if (projects.android && (environment.ANDROID_HOME ?? environment.ANDROID_SDK_ROOT ?? '') === '') {
    log('Warning: an Android project needs the Android SDK, and ANDROID_HOME is not set. mnci never accepts its licences: install it yourself (sdkmanager --licenses, then sdkmanager "platforms;android-37.0" "build-tools;36.0.0").')
  }

  return 0
}
